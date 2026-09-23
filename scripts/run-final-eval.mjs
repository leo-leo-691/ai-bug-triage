import fs from 'fs'
import path from 'path'

/**
 * ============================================================================
 * STAGE 4: FROZEN HELD-OUT EVALUATION PIPELINE
 * ============================================================================
 * 
 * Evaluates the FROZEN Ensemble configuration (R1: Baseline OR) against:
 *   (a) LLM Alone (v1 prompt, gemini-3.6-flash, temp 0)
 *   (b) Rule-Based Baseline Alone (keyword heuristic)
 *   (c) Ensemble (LLM predictions, overridden to Critical per frozen R1 rule)
 * 
 * Evaluated on:
 *   - Track A: Balanced Eclipse Held-Out (N=48)
 *   - Track A: Balanced Mozilla Held-Out (N=100)
 *   - Track A: Balanced Pooled Held-Out (N=148)
 *   - Track B: Natural Imbalance Pooled Held-Out (N=380)
 * 
 * STRICT COMPLIANCE:
 * - Read-only over cached data in predictions-cache.json
 * - Zero API calls
 * - Zero re-tuning or modifications to dev data, configs, or datasets
 */

const SEVERITY_TIERS = ['Critical', 'High', 'Medium', 'Low']
const TIER_RANK = { Critical: 3, High: 2, Medium: 1, Low: 0 }

/**
 * Wilson Score 95% Confidence Interval for proportion k / n
 */
function computeWilsonScoreInterval(k, n, confidence = 0.95) {
  if (n === 0) return { lower: 0, upper: 0, formatted: '[0.0%, 0.0%]' }
  const z = 1.95996398454 // 95% two-tailed standard normal quantile
  const p = k / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator

  const lower = Math.max(0, center - margin)
  const upper = Math.min(1, center + margin)

  return {
    lower,
    upper,
    formatted: `[${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%]`,
  }
}

/**
 * Exact Binomial Coefficient and Binomial CDF for McNemar Exact Test
 */
function logFactorial(n) {
  let sum = 0
  for (let i = 2; i <= n; i++) sum += Math.log(i)
  return sum
}

function logCombination(n, k) {
  if (k < 0 || k > n) return -Infinity
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

function exactBinomialTwoTailedPValue(b, c) {
  const n = b + c
  if (n === 0) return 1.0
  const kMin = Math.min(b, c)
  let pSum = 0
  for (let k = 0; k <= kMin; k++) {
    pSum += Math.exp(logCombination(n, k) - n * Math.LN2)
  }
  return Math.min(1.0, 2 * pSum)
}

/**
 * McNemar's Test on paired binary outcomes (e.g. Critical detection correctness)
 * b = Method 1 Wrong (0), Method 2 Correct (1)
 * c = Method 1 Correct (1), Method 2 Wrong (0)
 */
function computeMcNemarTest(m1Correct, m2Correct) {
  let a = 0, b = 0, c = 0, d = 0
  for (let i = 0; i < m1Correct.length; i++) {
    const r1 = m1Correct[i] ? 1 : 0
    const r2 = m2Correct[i] ? 1 : 0
    if (r1 === 1 && r2 === 1) a++
    else if (r1 === 0 && r2 === 1) b++
    else if (r1 === 1 && r2 === 0) c++
    else d++
  }

  const discordant = b + c
  const exactP = exactBinomialTwoTailedPValue(b, c)
  const chiSquare = discordant > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / discordant : 0

  return {
    contingency: { bothCorrect: a, m1Wrong_m2Correct: b, m1Correct_m2Wrong: c, bothWrong: d },
    discordantPairs: discordant,
    chiSquare: Number(chiSquare.toFixed(4)),
    exactPValue: Number(exactP.toFixed(5)),
    isSignificant: exactP < 0.05,
  }
}

/**
 * Cochran's Q test across k=3 matched binary classifiers on N items
 */
function computeCochransQ(matrix) {
  const N = matrix.length
  const k = 3
  if (N === 0) return { Q: 0, df: 2, pValue: 1.0 }

  const T = [0, 0, 0]
  let sumU = 0
  let sumU2 = 0

  for (let i = 0; i < N; i++) {
    const row = matrix[i]
    let u = 0
    for (let j = 0; j < k; j++) {
      if (row[j]) {
        T[j]++
        u++
      }
    }
    sumU += u
    sumU2 += u * u
  }

  let sumT2 = 0
  let sumT = 0
  for (let j = 0; j < k; j++) {
    sumT2 += T[j] * T[j]
    sumT += T[j]
  }

  const numerator = (k - 1) * (k * sumT2 - sumT * sumT)
  const denominator = k * sumU - sumU2

  if (denominator === 0) {
    return { Q: 0, df: 2, pValue: 1.0 }
  }

  const Q = numerator / denominator
  // For df=2, the Chi-Square Survival Function is exactly exp(-Q / 2)
  const pValue = Math.exp(-Q / 2)

  return {
    Q: Number(Q.toFixed(4)),
    df: 2,
    pValue: Number(pValue.toFixed(5)),
    isSignificant: pValue < 0.05,
  }
}

/**
 * Detailed Performance Evaluation for a single method on a bug dataset
 */
function evaluateMethod(groundTruth, predictions) {
  const N = groundTruth.length

  // 1. Confusion Matrix (rows = actual, cols = predicted)
  const confusionMatrix = {
    Critical: { Critical: 0, High: 0, Medium: 0, Low: 0 },
    High: { Critical: 0, High: 0, Medium: 0, Low: 0 },
    Medium: { Critical: 0, High: 0, Medium: 0, Low: 0 },
    Low: { Critical: 0, High: 0, Medium: 0, Low: 0 },
  }

  let exactMatches = 0
  let adjacentMatches = 0

  for (let i = 0; i < N; i++) {
    const actual = groundTruth[i]
    const pred = predictions[i]
    confusionMatrix[actual][pred]++

    if (actual === pred) exactMatches++
    if (Math.abs(TIER_RANK[actual] - TIER_RANK[pred]) <= 1) adjacentMatches++
  }

  const exactAccuracy = exactMatches / N
  const adjacentAccuracy = adjacentMatches / N

  // 2. Per-class metrics
  const perClass = {}
  for (const cls of SEVERITY_TIERS) {
    let tp = 0, fp = 0, fn = 0, tn = 0
    for (let i = 0; i < N; i++) {
      const actual = groundTruth[i]
      const pred = predictions[i]
      if (pred === cls && actual === cls) tp++
      else if (pred === cls && actual !== cls) fp++
      else if (pred !== cls && actual === cls) fn++
      else tn++
    }
    const support = tp + fn
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = support > 0 ? tp / support : 0
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

    perClass[cls] = {
      support,
      tp,
      fp,
      fn,
      tn,
      precision,
      recall,
      f1,
      wilsonRecall: computeWilsonScoreInterval(tp, support),
      wilsonPrecision: computeWilsonScoreInterval(tp, tp + fp),
    }
  }

  const macroF1 = (perClass.Critical.f1 + perClass.High.f1 + perClass.Medium.f1 + perClass.Low.f1) / 4
  const falseCriticalCount = perClass.Critical.fp

  return {
    exactAccuracy,
    adjacentAccuracy,
    macroF1,
    falseCriticalCount,
    perClass,
    confusionMatrix,
  }
}

/**
 * Evaluate all three methods across a given dataset slice
 */
function evaluateSlice(bugs, cache, sliceName) {
  const records = bugs.map((b) => {
    const c = cache[b.id]
    if (!c || c.status !== 'success') {
      throw new Error(`Missing cache for bug: ${b.id}`)
    }
    return {
      id: b.id,
      expected: b.expectedSeverity,
      llm: c.llm.severity,
      baseline: c.baseline.severity,
      // Frozen R1 Ensemble: Critical if LLM=Critical OR baseline=Critical, else retain LLM prediction
      ensemble: (c.llm.severity === 'Critical' || c.baseline.severity === 'Critical') ? 'Critical' : c.llm.severity,
    }
  })

  const groundTruth = records.map((r) => r.expected)
  const llmPreds = records.map((r) => r.llm)
  const basePreds = records.map((r) => r.baseline)
  const ensPreds = records.map((r) => r.ensemble)

  const llmEval = evaluateMethod(groundTruth, llmPreds)
  const baseEval = evaluateMethod(groundTruth, basePreds)
  const ensEval = evaluateMethod(groundTruth, ensPreds)

  // Statistical Tests on Critical-Class Detection (paired across ground-truth Critical bugs)
  const critIndices = []
  for (let i = 0; i < groundTruth.length; i++) {
    if (groundTruth[i] === 'Critical') critIndices.push(i)
  }

  const critLLMCorrect = critIndices.map((i) => llmPreds[i] === 'Critical')
  const critEnsCorrect = critIndices.map((i) => ensPreds[i] === 'Critical')
  const critBaseCorrect = critIndices.map((i) => basePreds[i] === 'Critical')

  const critMcNemar = computeMcNemarTest(critLLMCorrect, critEnsCorrect)

  const critMatrix = critIndices.map((i) => [
    llmPreds[i] === 'Critical',
    basePreds[i] === 'Critical',
    ensPreds[i] === 'Critical',
  ])
  const critCochran = computeCochransQ(critMatrix)

  // Statistical Tests on Overall 4-Class Exact Match Correctness
  const overallLLMCorrect = groundTruth.map((gt, i) => llmPreds[i] === gt)
  const overallBaseCorrect = groundTruth.map((gt, i) => basePreds[i] === gt)
  const overallEnsCorrect = groundTruth.map((gt, i) => ensPreds[i] === gt)

  const overallMcNemar = computeMcNemarTest(overallLLMCorrect, overallEnsCorrect)
  const overallMatrix = groundTruth.map((gt, i) => [
    llmPreds[i] === gt,
    basePreds[i] === gt,
    ensPreds[i] === gt,
  ])
  const overallCochran = computeCochransQ(overallMatrix)

  return {
    sliceName,
    bugCount: bugs.length,
    criticalCount: critIndices.length,
    methods: {
      llmAlone: llmEval,
      baselineAlone: baseEval,
      ensemble: ensEval,
    },
    statisticalTests: {
      criticalRecallMcNemar: critMcNemar,
      criticalRecallCochransQ: critCochran,
      overallAccuracyMcNemar: overallMcNemar,
      overallAccuracyCochransQ: overallCochran,
    },
    rawRecords: records,
  }
}

export function runFinalEvaluation() {
  console.log('========================================================================================')
  console.log('=== STAGE 4: FROZEN ENSEMBLE HELD-OUT EVALUATION PIPELINE (TRACK A & TRACK B) ===')
  console.log('========================================================================================\n')

  // 1. Load Frozen Ensemble Config
  const configPath = path.join(process.cwd(), 'scripts', 'ensemble-config.json')
  if (!fs.existsSync(configPath)) {
    throw new Error('ensemble-config.json not found! Run tune-ensemble.mjs first.')
  }
  const ensembleConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  console.log(`[Config Loaded] Frozen Rule: ${ensembleConfig.chosenRule} - ${ensembleConfig.ruleName}`)
  console.log(`[Rule Logic]   ${ensembleConfig.description}\n`)

  // 2. Load Cached Predictions
  const cachePath = path.join(process.cwd(), 'scripts', 'predictions-cache.json')
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))

  // 3. Load Held-Out Datasets (Strictly Quarantined Evaluation)
  const eHeld = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'eclipse-heldout-balanced.json'), 'utf-8'))
  const mHeld = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'mozilla-heldout-balanced.json'), 'utf-8'))
  const balancedPooled = [...eHeld, ...mHeld]
  const naturalPooled = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'heldout-natural-pooled.json'), 'utf-8'))

  // 4. Run Evaluation across all 4 slices
  const slices = [
    { name: 'Track A: Eclipse Held-Out Balanced (N=48)', data: eHeld },
    { name: 'Track A: Mozilla Held-Out Balanced (N=100)', data: mHeld },
    { name: 'Track A: Balanced Pooled Held-Out (N=148)', data: balancedPooled },
    { name: 'Track B: Natural Imbalance Pooled Held-Out (N=380)', data: naturalPooled },
  ]

  const evalResults = []

  for (const s of slices) {
    const res = evaluateSlice(s.data, cache, s.name)
    evalResults.push(res)
  }

  // 5. Print Clean Comparison Tables
  for (const res of evalResults) {
    console.log('========================================================================================')
    console.log(`=== SLICE: ${res.sliceName.toUpperCase()} ===`)
    console.log('========================================================================================')

    const summaryTable = [
      {
        Method: 'LLM Alone (v1 prompt)',
        'Exact Acc': `${(res.methods.llmAlone.exactAccuracy * 100).toFixed(1)}%`,
        '±1 Tier Acc': `${(res.methods.llmAlone.adjacentAccuracy * 100).toFixed(1)}%`,
        'Macro F1': `${(res.methods.llmAlone.macroF1 * 100).toFixed(1)}%`,
        'Crit Recall': `${(res.methods.llmAlone.perClass.Critical.recall * 100).toFixed(1)}% (${res.methods.llmAlone.perClass.Critical.tp}/${res.criticalCount})`,
        'Crit Recall 95% CI': res.methods.llmAlone.perClass.Critical.wilsonRecall.formatted,
        'Crit Precision': `${(res.methods.llmAlone.perClass.Critical.precision * 100).toFixed(1)}% (${res.methods.llmAlone.perClass.Critical.tp}/${res.methods.llmAlone.perClass.Critical.tp + res.methods.llmAlone.perClass.Critical.fp})`,
        'Crit Precision 95% CI': res.methods.llmAlone.perClass.Critical.wilsonPrecision.formatted,
        'Crit F1': `${(res.methods.llmAlone.perClass.Critical.f1 * 100).toFixed(1)}%`,
        'False-Crit (FP)': res.methods.llmAlone.falseCriticalCount,
      },
      {
        Method: 'Rule Baseline Alone',
        'Exact Acc': `${(res.methods.baselineAlone.exactAccuracy * 100).toFixed(1)}%`,
        '±1 Tier Acc': `${(res.methods.baselineAlone.adjacentAccuracy * 100).toFixed(1)}%`,
        'Macro F1': `${(res.methods.baselineAlone.macroF1 * 100).toFixed(1)}%`,
        'Crit Recall': `${(res.methods.baselineAlone.perClass.Critical.recall * 100).toFixed(1)}% (${res.methods.baselineAlone.perClass.Critical.tp}/${res.criticalCount})`,
        'Crit Recall 95% CI': res.methods.baselineAlone.perClass.Critical.wilsonRecall.formatted,
        'Crit Precision': `${(res.methods.baselineAlone.perClass.Critical.precision * 100).toFixed(1)}% (${res.methods.baselineAlone.perClass.Critical.tp}/${res.methods.baselineAlone.perClass.Critical.tp + res.methods.baselineAlone.perClass.Critical.fp})`,
        'Crit Precision 95% CI': res.methods.baselineAlone.perClass.Critical.wilsonPrecision.formatted,
        'Crit F1': `${(res.methods.baselineAlone.perClass.Critical.f1 * 100).toFixed(1)}%`,
        'False-Crit (FP)': res.methods.baselineAlone.falseCriticalCount,
      },
      {
        Method: 'Ensemble (Frozen R1)',
        'Exact Acc': `${(res.methods.ensemble.exactAccuracy * 100).toFixed(1)}%`,
        '±1 Tier Acc': `${(res.methods.ensemble.adjacentAccuracy * 100).toFixed(1)}%`,
        'Macro F1': `${(res.methods.ensemble.macroF1 * 100).toFixed(1)}%`,
        'Crit Recall': `${(res.methods.ensemble.perClass.Critical.recall * 100).toFixed(1)}% (${res.methods.ensemble.perClass.Critical.tp}/${res.criticalCount})`,
        'Crit Recall 95% CI': res.methods.ensemble.perClass.Critical.wilsonRecall.formatted,
        'Crit Precision': `${(res.methods.ensemble.perClass.Critical.precision * 100).toFixed(1)}% (${res.methods.ensemble.perClass.Critical.tp}/${res.methods.ensemble.perClass.Critical.tp + res.methods.ensemble.perClass.Critical.fp})`,
        'Crit Precision 95% CI': res.methods.ensemble.perClass.Critical.wilsonPrecision.formatted,
        'Crit F1': `${(res.methods.ensemble.perClass.Critical.f1 * 100).toFixed(1)}%`,
        'False-Crit (FP)': res.methods.ensemble.falseCriticalCount,
      },
    ]

    console.table(summaryTable)

    // Per-Class Breakdown Table
    console.log('\n--- Per-Class Metrics (Ensemble vs LLM Alone) ---')
    const perClassTable = SEVERITY_TIERS.map((cls) => ({
      Tier: cls,
      Support: res.methods.ensemble.perClass[cls].support,
      'LLM Prec': `${(res.methods.llmAlone.perClass[cls].precision * 100).toFixed(1)}%`,
      'LLM Rec': `${(res.methods.llmAlone.perClass[cls].recall * 100).toFixed(1)}%`,
      'LLM F1': `${(res.methods.llmAlone.perClass[cls].f1 * 100).toFixed(1)}%`,
      'Ensemble Prec': `${(res.methods.ensemble.perClass[cls].precision * 100).toFixed(1)}%`,
      'Ensemble Rec': `${(res.methods.ensemble.perClass[cls].recall * 100).toFixed(1)}%`,
      'Ensemble F1': `${(res.methods.ensemble.perClass[cls].f1 * 100).toFixed(1)}%`,
      'F1 Delta': `${((res.methods.ensemble.perClass[cls].f1 - res.methods.llmAlone.perClass[cls].f1) * 100).toFixed(1)}%`,
    }))
    console.table(perClassTable)

    // Statistical Tests
    const mc = res.statisticalTests.criticalRecallMcNemar
    const cq = res.statisticalTests.criticalRecallCochransQ
    console.log('\n--- Statistical Significance Tests (Critical Recall: Ensemble vs LLM Alone) ---')
    console.log(`McNemar Test:  Exact Two-Tailed p-value = ${mc.exactPValue} (Discordant pairs b=${mc.contingency.m1Wrong_m2Correct}, c=${mc.contingency.m1Correct_m2Wrong})`)
    console.log(`Cochran's Q:   Q = ${cq.Q} (df=2), p-value = ${cq.pValue}`)
    console.log(`Significance:  ${mc.isSignificant ? 'STATISTICALLY SIGNIFICANT (p < 0.05)' : 'NOT statistically significant at alpha=0.05'}\n`)
  }

  // 6. Save Complete Structured Results to scripts/final-eval-results.json
  const outputPath = path.join(process.cwd(), 'scripts', 'final-eval-results.json')
  const finalOutput = {
    evalTimestamp: new Date().toISOString(),
    frozenEnsembleConfig: ensembleConfig,
    slices: evalResults.map((r) => ({
      sliceName: r.sliceName,
      bugCount: r.bugCount,
      criticalCount: r.criticalCount,
      summary: {
        llmAlone: {
          exactAccuracy: Number(r.methods.llmAlone.exactAccuracy.toFixed(4)),
          adjacentAccuracy: Number(r.methods.llmAlone.adjacentAccuracy.toFixed(4)),
          macroF1: Number(r.methods.llmAlone.macroF1.toFixed(4)),
          falseCriticalCount: r.methods.llmAlone.falseCriticalCount,
          criticalRecallFormatted: `${(r.methods.llmAlone.perClass.Critical.recall * 100).toFixed(1)}% (${r.methods.llmAlone.perClass.Critical.tp}/${r.criticalCount})`,
          criticalRecall95CI: r.methods.llmAlone.perClass.Critical.wilsonRecall,
          criticalPrecisionFormatted: `${(r.methods.llmAlone.perClass.Critical.precision * 100).toFixed(1)}% (${r.methods.llmAlone.perClass.Critical.tp}/${r.methods.llmAlone.perClass.Critical.tp + r.methods.llmAlone.perClass.Critical.fp})`,
          criticalPrecision95CI: r.methods.llmAlone.perClass.Critical.wilsonPrecision,
          criticalF1: Number(r.methods.llmAlone.perClass.Critical.f1.toFixed(4)),
        },
        baselineAlone: {
          exactAccuracy: Number(r.methods.baselineAlone.exactAccuracy.toFixed(4)),
          adjacentAccuracy: Number(r.methods.baselineAlone.adjacentAccuracy.toFixed(4)),
          macroF1: Number(r.methods.baselineAlone.macroF1.toFixed(4)),
          falseCriticalCount: r.methods.baselineAlone.falseCriticalCount,
          criticalRecallFormatted: `${(r.methods.baselineAlone.perClass.Critical.recall * 100).toFixed(1)}% (${r.methods.baselineAlone.perClass.Critical.tp}/${r.criticalCount})`,
          criticalRecall95CI: r.methods.baselineAlone.perClass.Critical.wilsonRecall,
          criticalPrecisionFormatted: `${(r.methods.baselineAlone.perClass.Critical.precision * 100).toFixed(1)}% (${r.methods.baselineAlone.perClass.Critical.tp}/${r.methods.baselineAlone.perClass.Critical.tp + r.methods.baselineAlone.perClass.Critical.fp})`,
          criticalPrecision95CI: r.methods.baselineAlone.perClass.Critical.wilsonPrecision,
          criticalF1: Number(r.methods.baselineAlone.perClass.Critical.f1.toFixed(4)),
        },
        ensemble: {
          exactAccuracy: Number(r.methods.ensemble.exactAccuracy.toFixed(4)),
          adjacentAccuracy: Number(r.methods.ensemble.adjacentAccuracy.toFixed(4)),
          macroF1: Number(r.methods.ensemble.macroF1.toFixed(4)),
          falseCriticalCount: r.methods.ensemble.falseCriticalCount,
          criticalRecallFormatted: `${(r.methods.ensemble.perClass.Critical.recall * 100).toFixed(1)}% (${r.methods.ensemble.perClass.Critical.tp}/${r.criticalCount})`,
          criticalRecall95CI: r.methods.ensemble.perClass.Critical.wilsonRecall,
          criticalPrecisionFormatted: `${(r.methods.ensemble.perClass.Critical.precision * 100).toFixed(1)}% (${r.methods.ensemble.perClass.Critical.tp}/${r.methods.ensemble.perClass.Critical.tp + r.methods.ensemble.perClass.Critical.fp})`,
          criticalPrecision95CI: r.methods.ensemble.perClass.Critical.wilsonPrecision,
          criticalF1: Number(r.methods.ensemble.perClass.Critical.f1.toFixed(4)),
        },
      },
      perClassMetrics: {
        llmAlone: r.methods.llmAlone.perClass,
        baselineAlone: r.methods.baselineAlone.perClass,
        ensemble: r.methods.ensemble.perClass,
      },
      confusionMatrices: {
        llmAlone: r.methods.llmAlone.confusionMatrix,
        baselineAlone: r.methods.baselineAlone.confusionMatrix,
        ensemble: r.methods.ensemble.confusionMatrix,
      },
      statisticalTests: r.statisticalTests,
    })),
  }

  fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2))
  console.log(`[Export Complete] Full evaluation results written to: scripts/final-eval-results.json\n`)

  return finalOutput
}

const isMain = process.argv[1] && process.argv[1].endsWith('run-final-eval.mjs')
if (isMain) {
  try {
    runFinalEvaluation()
  } catch (err) {
    console.error('Final evaluation error:', err)
    process.exit(1)
  }
}
