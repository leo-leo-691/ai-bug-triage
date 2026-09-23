import fs from 'fs'
import path from 'path'
import { TEST_SET } from './run-evaluation.mjs'
import { heuristicClassification } from '../lib/ai-orchestrator.ts'

// 1. Load Datasets
const diagnosticBugs = TEST_SET.filter(b => !b.isAmbiguous)

const datasetPath = path.join(process.cwd(), 'scripts', 'sampled_external_dataset.json')
const SAMPLED_DATASET = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'))
const externalBugs = SAMPLED_DATASET

// 2. Load LLM Results
const evalResultsPath = path.join(process.cwd(), 'scripts', 'evaluation-results.json')
const evalResults = JSON.parse(fs.readFileSync(evalResultsPath, 'utf-8'))
const llmDiagRecordsMap = new Map(evalResults.sampleRecords.filter(r => !r.isAmbiguous).map(r => [r.id, r]))

const extEvalResultsPath = path.join(process.cwd(), 'scripts', 'external-evaluation-results.json')
const extEvalResults = JSON.parse(fs.readFileSync(extEvalResultsPath, 'utf-8'))
const llmExtRecordsMap = new Map(extEvalResults.sampleRecords.map(r => [r.id, r]))

// 3. Load Baseline Metrics (for final table)
const baselineResultsPath = path.join(process.cwd(), 'scripts', 'baseline-comparison-results.json')
const baselineResults = JSON.parse(fs.readFileSync(baselineResultsPath, 'utf-8'))

function stripPrefix(text) {
  const prefixRegex = /^\[[^\]]+\]\s*Bug\s*#?\d+:?\s*/i
  return text.replace(prefixRegex, '')
}

function computeMetrics(records) {
  let exactMatches = 0
  const total = records.length
  
  const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low']
  const confusionMatrix = {}
  const perClass = {}

  for (const lvl of SEVERITY_LEVELS) {
    confusionMatrix[lvl] = { 'Critical': 0, 'High': 0, 'Medium': 0, 'Low': 0 }
    perClass[lvl] = { tp: 0, fp: 0, fn: 0 }
  }

  for (const r of records) {
    const exp = r.expectedSeverity
    const act = r.actualSeverity

    if (exp === act) exactMatches++
    
    if (confusionMatrix[exp] && confusionMatrix[exp][act] !== undefined) {
      confusionMatrix[exp][act]++
    }

    for (const lvl of SEVERITY_LEVELS) {
      if (exp === lvl && act === lvl) perClass[lvl].tp++
      else if (exp !== lvl && act === lvl) perClass[lvl].fp++
      else if (exp === lvl && act !== lvl) perClass[lvl].fn++
    }
  }

  const exactAccuracy = (exactMatches / total) * 100

  for (const lvl of SEVERITY_LEVELS) {
    const p = perClass[lvl]
    p.precision = p.tp + p.fp > 0 ? (p.tp / (p.tp + p.fp)) * 100 : 0
    p.recall = p.tp + p.fn > 0 ? (p.tp / (p.tp + p.fn)) * 100 : 0
    p.f1 = p.precision + p.recall > 0 ? (2 * p.precision * p.recall) / (p.precision + p.recall) : 0
  }

  return {
    total,
    exactAccuracy,
    confusionMatrix,
    perClass
  }
}

// 4. Compute Ensemble Predictions
function runEnsemble(bugs, llmMap) {
  const ensembleRecords = []
  
  for (const bug of bugs) {
    const ruleRes = heuristicClassification(stripPrefix(bug.title || ''), stripPrefix(bug.description || ''))
    const ruleSeverity = ruleRes.severity.severity
    
    const llmRecord = llmMap.get(bug.id)
    const llmSeverity = llmRecord ? llmRecord.actualSeverity : 'Medium'

    // Ensemble Rule: If EITHER is Critical, assign Critical. Else LLM.
    let ensembleSeverity = llmSeverity
    if (ruleSeverity === 'Critical' || llmSeverity === 'Critical') {
      ensembleSeverity = 'Critical'
    }

    ensembleRecords.push({
      ...bug,
      ruleSeverity,
      llmSeverity,
      actualSeverity: ensembleSeverity // For computeMetrics
    })
  }
  return ensembleRecords
}

const ensembleDiagRecords = runEnsemble(diagnosticBugs, llmDiagRecordsMap)
const ensembleExtRecords = runEnsemble(externalBugs, llmExtRecordsMap)

const ensembleDiagMetrics = computeMetrics(ensembleDiagRecords)
const ensembleExtMetrics = computeMetrics(ensembleExtRecords)

// 5. Output Results
console.log('===============================================================')
console.log('         ENSEMBLE COMPARISON (LLM + RULE-BASED BASELINE)')
console.log('===============================================================')

const comparisonTable = [
  {
    'Method': 'Rule-Based Baseline (heuristicClassification)',
    'Diag Accuracy': `${baselineResults.baseline.diagnostic.exactAccuracy.toFixed(1)}%`,
    'Ext Accuracy': `${baselineResults.baseline.external.exactAccuracy.toFixed(1)}%`,
    'Ext Critical Recall': `${baselineResults.baseline.external.perClass['Critical'].recall.toFixed(1)}%`,
    'Ext Critical Precision': `${baselineResults.baseline.external.perClass['Critical'].precision.toFixed(1)}%`
  },
  {
    'Method': 'LLM Alone (v1 Prompt)',
    'Diag Accuracy': `${baselineResults.llm_v1.diagnostic.accuracy.toFixed(1)}%`,
    'Ext Accuracy': `${baselineResults.llm_v1.external.accuracy.toFixed(1)}%`,
    'Ext Critical Recall': `${baselineResults.llm_v1.external.criticalRecall.toFixed(1)}%`,
    'Ext Critical Precision': `${extEvalResults.perClassMetrics['Critical'].precisionPercentage.toFixed(1)}%`
  },
  {
    'Method': 'Ensemble (LLM + Baseline)',
    'Diag Accuracy': `${ensembleDiagMetrics.exactAccuracy.toFixed(1)}%`,
    'Ext Accuracy': `${ensembleExtMetrics.exactAccuracy.toFixed(1)}%`,
    'Ext Critical Recall': `${ensembleExtMetrics.perClass['Critical'].recall.toFixed(1)}%`,
    'Ext Critical Precision': `${ensembleExtMetrics.perClass['Critical'].precision.toFixed(1)}%`
  }
]

console.table(comparisonTable)

const outputPayload = {
  ensemble: {
    diagnostic: ensembleDiagMetrics,
    external: ensembleExtMetrics
  },
  comparisonTable,
  records: {
    diagnostic: ensembleDiagRecords,
    external: ensembleExtRecords
  }
}

const outputPath = path.join(process.cwd(), 'scripts', 'ensemble-comparison-results.json')
fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8')
console.log(`\n✓ Successfully exported ensemble comparison results to: ${outputPath}`)
