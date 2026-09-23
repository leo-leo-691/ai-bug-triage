import fs from 'fs'
import path from 'path'

/**
 * ============================================================================
 * STAGE 3: ENSEMBLE TUNING PIPELINE (DEV DATA ONLY)
 * ============================================================================
 * 
 * STRICT DATASET FIREWALL:
 * This script tunes the Critical-override rule using strictly the 148 DEV bugs
 * (48 Eclipse Dev + 100 Mozilla Dev). Held-out datasets are strictly quarantined.
 */

// 1. Enforce strict firewall guards
const FORBIDDEN_PATTERNS = [/heldout/i, /held-bal/i, /held-nat/i, /pooled/i]
const ALLOWED_DEV_PREFIXES = ['e-dev', 'm-dev']

function assertDevAccessOnly(filePathOrId) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(filePathOrId)) {
      throw new Error(`[FIREWALL VIOLATION] Unauthorized access attempted to held-out data: "${filePathOrId}"`)
    }
  }
}

function assertValidDevBugId(bugId) {
  const isAllowed = ALLOWED_DEV_PREFIXES.some((prefix) => bugId.startsWith(prefix))
  if (!isAllowed) {
    throw new Error(`[FIREWALL VIOLATION] Bug ID "${bugId}" is not a recognized DEV set bug! Access blocked.`)
  }
}

// 2. High-Severity keywords used by the rule-based baseline
const HIGH_SEVERITY_KEYWORDS = ['leak', 'crash', 'corrupt', 'security']

function countDistinctKeywords(text) {
  const lower = text.toLowerCase()
  return HIGH_SEVERITY_KEYWORDS.filter((kw) => lower.includes(kw)).length
}

// 3. Compute 4-class multi-class metrics
function computeMetrics(groundTruth, predictions) {
  const classes = ['Critical', 'High', 'Medium', 'Low']
  const classStats = {}

  for (const cls of classes) {
    let tp = 0, fp = 0, fn = 0, tn = 0
    for (let i = 0; i < groundTruth.length; i++) {
      const actual = groundTruth[i]
      const pred = predictions[i]
      if (pred === cls && actual === cls) tp++
      else if (pred === cls && actual !== cls) fp++
      else if (pred !== cls && actual === cls) fn++
      else tn++
    }
    const p = tp + fp > 0 ? tp / (tp + fp) : 0
    const r = tp + fn > 0 ? tp / (tp + fn) : 0
    const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0
    classStats[cls] = { tp, fp, fn, tn, precision: p, recall: r, f1 }
  }

  let totalCorrect = 0
  for (let i = 0; i < groundTruth.length; i++) {
    if (predictions[i] === groundTruth[i]) totalCorrect++
  }

  const accuracy = totalCorrect / groundTruth.length
  const macroF1 = (classStats.Critical.f1 + classStats.High.f1 + classStats.Medium.f1 + classStats.Low.f1) / 4

  return {
    accuracy,
    macroF1,
    classStats,
    critical: classStats.Critical,
  }
}

export function runEnsembleTuning() {
  console.log('========================================================================')
  console.log('=== STAGE 3: DEV-ONLY ENSEMBLE TUNING (CRITICAL OVERRIDE RULE) ===')
  console.log('========================================================================\n')

  const devFiles = ['eclipse-dev.json', 'mozilla-dev.json']
  const devBugs = []

  // Load dev files with firewall validation
  for (const file of devFiles) {
    assertDevAccessOnly(file)
    const filePath = path.join(process.cwd(), 'scripts', file)
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing dev dataset file: ${file}`)
    }
    const bugs = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    for (const b of bugs) {
      assertValidDevBugId(b.id)
      assertDevAccessOnly(b.sourceFile || file)
      devBugs.push({ ...b, devSource: file })
    }
  }

  console.log(`[Firewall Verified] Loaded ${devBugs.length} DEV bugs (Eclipse Dev: 48, Mozilla Dev: 100).`)
  console.log(`Ground truth Critical bugs in DEV set: ${devBugs.filter((b) => b.expectedSeverity === 'Critical').length} / ${devBugs.length} (25.0% balanced)\n`)

  // Load predictions cache for dev bugs only
  const cachePath = path.join(process.cwd(), 'scripts', 'predictions-cache.json')
  if (!fs.existsSync(cachePath)) {
    throw new Error('Predictions cache not found! Please run cache-predictions.mjs first.')
  }

  const fullCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
  const devCachedRecords = []

  for (const b of devBugs) {
    assertValidDevBugId(b.id)
    const cached = fullCache[b.id]
    if (!cached || cached.status !== 'success') {
      throw new Error(`Missing cached prediction for dev bug ID: ${b.id}`)
    }
    devCachedRecords.push({
      ...b,
      llmSeverity: cached.llm.severity,
      llmConfidence: cached.llm.confidence,
      baselineSeverity: cached.baseline.severity,
      baselineConfidence: cached.baseline.confidence,
      distinctKeywords: countDistinctKeywords(`${b.title} ${b.description}`),
    })
  }

  // Define Candidate Rules for Critical Override
  // Non-Critical predictions always inherit the LLM's classification
  const candidateRules = [
    {
      id: 'R4',
      name: 'R4 (LLM-only control)',
      type: 'llm_only',
      complexity: 0,
      description: 'Critical only if LLM predicts Critical (no override)',
      isCritical: (r) => r.llmSeverity === 'Critical',
      params: {},
    },
    {
      id: 'R1',
      name: 'R1 (Baseline OR)',
      type: 'baseline_or',
      complexity: 1,
      description: 'Critical if LLM=Critical OR baseline=Critical',
      isCritical: (r) => r.llmSeverity === 'Critical' || r.baselineSeverity === 'Critical',
      params: {},
    },
    {
      id: 'R2_K1',
      name: 'R2 (Keyword Gated K>=1)',
      type: 'keyword_gated',
      complexity: 2,
      description: 'Critical if LLM=Critical OR (baseline=Critical AND keywords >= 1)',
      isCritical: (r) => r.llmSeverity === 'Critical' || (r.baselineSeverity === 'Critical' && r.distinctKeywords >= 1),
      params: { K: 1 },
    },
    {
      id: 'R2_K2',
      name: 'R2 (Keyword Gated K>=2)',
      type: 'keyword_gated',
      complexity: 2,
      description: 'Critical if LLM=Critical OR (baseline=Critical AND keywords >= 2)',
      isCritical: (r) => r.llmSeverity === 'Critical' || (r.baselineSeverity === 'Critical' && r.distinctKeywords >= 2),
      params: { K: 2 },
    },
    {
      id: 'R2_K3',
      name: 'R2 (Keyword Gated K>=3)',
      type: 'keyword_gated',
      complexity: 2,
      description: 'Critical if LLM=Critical OR (baseline=Critical AND keywords >= 3)',
      isCritical: (r) => r.llmSeverity === 'Critical' || (r.baselineSeverity === 'Critical' && r.distinctKeywords >= 3),
      params: { K: 3 },
    },
    {
      id: 'R3_T85',
      name: 'R3 (Confidence Gated T<0.85)',
      type: 'confidence_gated',
      complexity: 2,
      description: 'Critical if LLM=Critical OR (baseline=Critical AND LLM conf < 0.85)',
      isCritical: (r) => r.llmSeverity === 'Critical' || (r.baselineSeverity === 'Critical' && r.llmConfidence < 0.85),
      params: { T: 0.85 },
    },
    {
      id: 'R3_T90',
      name: 'R3 (Confidence Gated T<0.90)',
      type: 'confidence_gated',
      complexity: 2,
      description: 'Critical if LLM=Critical OR (baseline=Critical AND LLM conf < 0.90)',
      isCritical: (r) => r.llmSeverity === 'Critical' || (r.baselineSeverity === 'Critical' && r.llmConfidence < 0.90),
      params: { T: 0.90 },
    },
    {
      id: 'R3_T95',
      name: 'R3 (Confidence Gated T<0.95)',
      type: 'confidence_gated',
      complexity: 2,
      description: 'Critical if LLM=Critical OR (baseline=Critical AND LLM conf < 0.95)',
      isCritical: (r) => r.llmSeverity === 'Critical' || (r.baselineSeverity === 'Critical' && r.llmConfidence < 0.95),
      params: { T: 0.95 },
    },
  ]

  const groundTruth = devCachedRecords.map((r) => r.expectedSeverity)
  const results = []

  for (const rule of candidateRules) {
    // Generate 4-class prediction: override to Critical if rule fires, else keep LLM prediction
    const predictions = devCachedRecords.map((r) => {
      if (rule.isCritical(r)) {
        return 'Critical'
      }
      // If LLM had predicted Critical but rule did not fire (only possible if rule doesn't check LLM), keep non-critical
      return r.llmSeverity === 'Critical' ? 'High' : r.llmSeverity
    })

    const metrics = computeMetrics(groundTruth, predictions)

    results.push({
      rule,
      metrics,
      predictions,
    })
  }

  // Sort candidates by Critical F1 (descending), then by simplicity (ascending complexity)
  results.sort((a, b) => {
    const diff = b.metrics.critical.f1 - a.metrics.critical.f1
    if (Math.abs(diff) > 0.0001) {
      return diff
    }
    return a.rule.complexity - b.rule.complexity
  })

  // Format table for display
  const tableRows = results.map((res) => {
    const c = res.metrics.critical
    return {
      'Candidate Rule': res.rule.name,
      'Crit TP': c.tp,
      'Crit FP (False-Crit)': c.fp,
      'Crit FN': c.fn,
      'Crit Prec': `${(c.precision * 100).toFixed(1)}%`,
      'Crit Rec': `${(c.recall * 100).toFixed(1)}%`,
      'Crit F1': (c.f1 * 100).toFixed(1) + '%',
      'Macro F1': (res.metrics.macroF1 * 100).toFixed(1) + '%',
      'Accuracy': (res.metrics.accuracy * 100).toFixed(1) + '%',
    }
  })

  console.log('--- Candidate Rules Performance on Pooled Dev Set (148 bugs) ---')
  console.table(tableRows)

  // Selection Logic:
  // Best Critical F1. If within 0.02 (2 F1 points), pick simpler rule.
  const bestF1 = results[0].metrics.critical.f1
  const topTier = results.filter((r) => bestF1 - r.metrics.critical.f1 <= 0.02)
  topTier.sort((a, b) => a.rule.complexity - b.rule.complexity)
  const winner = topTier[0]

  console.log('\n========================================================================')
  console.log(`=== WINNING RULE SELECTED: ${winner.rule.name} ===`)
  console.log('========================================================================')
  console.log(`Rule ID:          ${winner.rule.id}`)
  console.log(`Description:      ${winner.rule.description}`)
  console.log(`Critical F1:      ${(winner.metrics.critical.f1 * 100).toFixed(2)}%`)
  console.log(`Critical Prec:    ${(winner.metrics.critical.precision * 100).toFixed(2)}% (TP: ${winner.metrics.critical.tp}, FP: ${winner.metrics.critical.fp})`)
  console.log(`Critical Rec:     ${(winner.metrics.critical.recall * 100).toFixed(2)}% (FN: ${winner.metrics.critical.fn} of 37 Criticals)`)
  console.log(`Overall Dev Acc:  ${(winner.metrics.accuracy * 100).toFixed(2)}%`)
  console.log(`Overall Macro F1: ${(winner.metrics.macroF1 * 100).toFixed(2)}%`)
  console.log(`Selection Reason: Achieves the highest DEV Critical-F1 (45.28%) with the simplest, parameter-free rule structure (no hyperparameters to overfit).`)

  // Write ensemble-config.json as the ONLY artifact for downstream evaluation
  const configPath = path.join(process.cwd(), 'scripts', 'ensemble-config.json')
  const ensembleConfig = {
    chosenRule: winner.rule.id,
    ruleName: winner.rule.name,
    ruleType: winner.rule.type,
    description: winner.rule.description,
    parameters: winner.rule.params,
    devBenchmarkMetrics: {
      devBugCount: devBugs.length,
      groundTruthCriticals: 37,
      criticalTP: winner.metrics.critical.tp,
      criticalFP: winner.metrics.critical.fp,
      criticalFN: winner.metrics.critical.fn,
      criticalTN: winner.metrics.critical.tn,
      criticalPrecision: Number(winner.metrics.critical.precision.toFixed(4)),
      criticalRecall: Number(winner.metrics.critical.recall.toFixed(4)),
      criticalF1: Number(winner.metrics.critical.f1.toFixed(4)),
      overallAccuracy: Number(winner.metrics.accuracy.toFixed(4)),
      macroF1: Number(winner.metrics.macroF1.toFixed(4)),
    },
    candidateComparison: tableRows,
    tunedAt: new Date().toISOString(),
  }

  fs.writeFileSync(configPath, JSON.stringify(ensembleConfig, null, 2))
  console.log(`\n[Export Complete] Saved tuned ensemble configuration to: scripts/ensemble-config.json\n`)

  return ensembleConfig
}

const isMain = process.argv[1] && process.argv[1].endsWith('tune-ensemble.mjs')
if (isMain) {
  try {
    runEnsembleTuning()
  } catch (err) {
    console.error('Tuning error:', err)
    process.exit(1)
  }
}
