import './_guard.mjs'
import fs from 'fs'
import path from 'path'
import { TEST_SET } from './run-evaluation.mjs'
import { heuristicClassification } from '../lib/ai-orchestrator.ts'

// 1. Load Existing LLM Results
const evalResultsPath = path.join(process.cwd(), 'scripts', 'evaluation-results.json')
const evalResults = JSON.parse(fs.readFileSync(evalResultsPath, 'utf-8'))

const extEvalResultsPath = path.join(process.cwd(), 'scripts', 'external-evaluation-results.json')
const extEvalResults = JSON.parse(fs.readFileSync(extEvalResultsPath, 'utf-8'))

function getCritRecallFromCM(cm) {
  const tp = cm['Critical']['Critical'] || 0
  let fn = 0
  for (const act of ['High', 'Medium', 'Low']) {
    fn += cm['Critical'][act] || 0
  }
  return tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0
}

const llmDiagAcc = evalResults.accuracyPercentage
const llmDiagCritRecall = getCritRecallFromCM(evalResults.confusionMatrix)
const llmExtAcc = extEvalResults.exactAccuracyPercentage
const llmExtCritRecall = extEvalResults.perClassMetrics['Critical'].recallPercentage

// 2. Load Datasets for Baseline
const diagnosticBugs = TEST_SET.filter(b => !b.isAmbiguous).map(b => ({
  id: `diag-${b.id}`,
  title: b.title,
  description: b.description,
  expectedSeverity: b.expectedSeverity
}))

const datasetPath = path.join(process.cwd(), 'scripts', 'sampled_external_dataset.json')
const SAMPLED_DATASET = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'))
const externalBugs = SAMPLED_DATASET.map(b => ({
  id: `ext-${b.id}`,
  title: b.title,
  description: b.description,
  expectedSeverity: b.expectedSeverity
}))

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

// 3. Run Baseline
const baselineDiagRecords = []
for (const bug of diagnosticBugs) {
  const res = heuristicClassification(stripPrefix(bug.title), stripPrefix(bug.description))
  baselineDiagRecords.push({ ...bug, actualSeverity: res.severity.severity })
}

const baselineExtRecords = []
for (const bug of externalBugs) {
  const res = heuristicClassification(stripPrefix(bug.title), stripPrefix(bug.description))
  baselineExtRecords.push({ ...bug, actualSeverity: res.severity.severity })
}

const baselineDiagMetrics = computeMetrics(baselineDiagRecords)
const baselineExtMetrics = computeMetrics(baselineExtRecords)

// 4. Output Results
console.log('===============================================================')
console.log('         BASELINE (RULE-BASED) VS LLM (V1) COMPARISON')
console.log('===============================================================')

const comparisonTable = [
  {
    'Method': 'Rule-Based Baseline (heuristicClassification)',
    'Diag Accuracy': `${baselineDiagMetrics.exactAccuracy.toFixed(1)}%`,
    'Diag Critical Recall': `${baselineDiagMetrics.perClass['Critical'].recall.toFixed(1)}%`,
    'Ext Accuracy': `${baselineExtMetrics.exactAccuracy.toFixed(1)}%`,
    'Ext Critical Recall': `${baselineExtMetrics.perClass['Critical'].recall.toFixed(1)}%`
  },
  {
    'Method': 'LLM (v1 Prompt - from existing logs)',
    'Diag Accuracy': `${llmDiagAcc.toFixed(1)}%`,
    'Diag Critical Recall': `${llmDiagCritRecall.toFixed(1)}%`,
    'Ext Accuracy': `${llmExtAcc.toFixed(1)}%`,
    'Ext Critical Recall': `${llmExtCritRecall.toFixed(1)}%`
  }
]

console.table(comparisonTable)

const outputPayload = {
  baseline: {
    diagnostic: baselineDiagMetrics,
    external: baselineExtMetrics
  },
  llm_v1: {
    diagnostic: {
      accuracy: llmDiagAcc,
      criticalRecall: llmDiagCritRecall
    },
    external: {
      accuracy: llmExtAcc,
      criticalRecall: llmExtCritRecall
    }
  },
  comparisonTable
}

const outputPath = path.join(process.cwd(), 'scripts', 'baseline-comparison-results.json')
fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8')
console.log(`\n✓ Successfully exported comparison results to: ${outputPath}`)
