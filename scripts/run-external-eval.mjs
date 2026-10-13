import './_guard.mjs'
import { createClient } from '@supabase/supabase-js'
import { orchestrateBugTriage } from '../lib/ai-orchestrator.ts'
import fs from 'fs'
import path from 'path'

// Read sampled dataset
const datasetPath = path.join(process.cwd(), 'scripts', 'sampled_external_dataset.json')
const SAMPLED_DATASET = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'))

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

const SEVERITY_TIERS = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
}

const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low']

async function runExternalEvaluation() {
  console.log('===============================================================')
  console.log('--- EXTERNAL EVALUATION STUDY: ECLIPSE BUGZILLA DATASET ---')
  console.log('===============================================================\n')
  console.log(`Evaluating stratified sample: ${SAMPLED_DATASET.length} real-world bug reports (12 per class)`)
  console.log('Source: AliArshad/Bugzilla_Eclipse_Bug_Reports_Dataset (MSR 2013 Mining Challenge)\n')

  const evaluationRecords = []
  let pendingReviewCount = 0
  let pendingTriageCount = 0

  for (let i = 0; i < SAMPLED_DATASET.length; i++) {
    const item = SAMPLED_DATASET[i]
    process.stdout.write(`[${(i + 1).toString().padStart(2, '0')}/${SAMPLED_DATASET.length}] #${item.sourceBugId} (${item.rawSeverity} ➔ ${item.expectedSeverity}): "${item.title.slice(0, 40)}..." `)

    // 1. Insert into bug_reports table to get realistic DB UUID and environment
    const { data: bugRow, error: insertErr } = await supabase
      .from('bug_reports')
      .insert({
        title: item.title,
        description: item.description,
        status: 'new',
      })
      .select('id')
      .single()

    if (insertErr || !bugRow) {
      console.error(`\nFailed to insert bug #${item.id}:`, insertErr?.message)
      continue
    }

    // 2. Run through orchestrateBugTriage()
    const triageResult = await orchestrateBugTriage(bugRow.id, {
      title: item.title,
      description: item.description,
    })

    const actualSeverity = triageResult.severity.severity
    const confidence = triageResult.severity.confidence
    const status = triageResult.appliedStatus

    if (status === 'pending_review') pendingReviewCount++
    if (status === 'pending_triage') pendingTriageCount++

    evaluationRecords.push({
      id: item.id,
      sourceBugId: item.sourceBugId,
      project: item.project,
      rawSeverity: item.rawSeverity,
      title: item.title,
      expectedSeverity: item.expectedSeverity,
      actualSeverity,
      confidence,
      reason: triageResult.severity.reason,
      tags: triageResult.tags,
      status,
      isExactMatch: actualSeverity.toLowerCase() === item.expectedSeverity.toLowerCase(),
      isAdjacentMatch: Math.abs(SEVERITY_TIERS[actualSeverity] - SEVERITY_TIERS[item.expectedSeverity]) <= 1,
    })

    console.log(`➔ [${actualSeverity}] (conf: ${(confidence * 100).toFixed(1)}%, status: ${status})`)
  }

  // =========================================================================
  // METRICS COMPUTATION
  // =========================================================================

  const total = evaluationRecords.length
  const exactMatches = evaluationRecords.filter((r) => r.isExactMatch).length
  const adjacentMatches = evaluationRecords.filter((r) => r.isAdjacentMatch).length

  const exactAccuracy = (exactMatches / total) * 100
  const adjacentAccuracy = (adjacentMatches / total) * 100

  // Confusion Matrix (Rows = Expected, Columns = Actual)
  const confusionMatrix = {}
  for (const exp of SEVERITY_LEVELS) {
    confusionMatrix[exp] = {}
    for (const act of SEVERITY_LEVELS) {
      confusionMatrix[exp][act] = 0
    }
  }

  for (const r of evaluationRecords) {
    if (confusionMatrix[r.expectedSeverity] && confusionMatrix[r.expectedSeverity][r.actualSeverity] !== undefined) {
      confusionMatrix[r.expectedSeverity][r.actualSeverity]++
    }
  }

  // Per-Class Precision, Recall, and F1-Score
  const perClassMetrics = {}
  for (const lvl of SEVERITY_LEVELS) {
    let tp = 0
    let fp = 0
    let fn = 0

    for (const r of evaluationRecords) {
      const exp = r.expectedSeverity === lvl
      const act = r.actualSeverity === lvl

      if (exp && act) tp++
      else if (!exp && act) fp++
      else if (exp && !act) fn++
    }

    const prec = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0
    const rec = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0

    perClassMetrics[lvl] = {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precisionPercentage: Number(prec.toFixed(2)),
      recallPercentage: Number(rec.toFixed(2)),
      f1Score: Number(f1.toFixed(2)),
    }
  }

  // =========================================================================
  // DISPLAY RESULTS TABLE
  // =========================================================================

  console.log('\n===============================================================')
  console.log('              EXTERNAL EVALUATION RESULTS (ECLIPSE)            ')
  console.log('===============================================================\n')

  console.log('--- CONFUSION MATRIX (Rows = Expected Bugzilla Tier, Columns = AI Model Assigned) ---')
  console.table(confusionMatrix)

  console.log('\n--- PER-CLASS METRICS ---')
  console.table(perClassMetrics)

  console.log('--- SUMMARY METRICS ---')
  console.log(`• Exact-Match Accuracy       : ${exactAccuracy.toFixed(2)}% (${exactMatches}/${total})`)
  console.log(`• Adjacent Accuracy (±1 tier): ${adjacentAccuracy.toFixed(2)}% (${adjacentMatches}/${total})`)
  console.log(`• Pending Review (<0.6 conf) : ${pendingReviewCount}/${total} (${((pendingReviewCount / total) * 100).toFixed(1)}%)`)
  console.log(`• AI Failure Fallback Hits   : ${pendingTriageCount}/${total}`)

  // =========================================================================
  // WRITE RESULTS TO scripts/external-evaluation-results.json
  // =========================================================================

  const outputPayload = {
    dataset: 'AliArshad/Bugzilla_Eclipse_Bug_Reports_Dataset',
    evaluatedAt: new Date().toISOString(),
    totalSamples: total,
    exactMatches,
    exactAccuracyPercentage: Number(exactAccuracy.toFixed(2)),
    adjacentMatches,
    adjacentAccuracyPercentage: Number(adjacentAccuracy.toFixed(2)),
    pendingReviewCount,
    pendingTriageCount,
    confusionMatrix,
    perClassMetrics,
    sampleRecords: evaluationRecords,
  }

  const outputPath = path.join(process.cwd(), 'scripts', 'external-evaluation-results.json')
  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8')
  console.log(`\n✓ Successfully exported external evaluation results to: ${outputPath}`)
  console.log('===============================================================\n')
}

runExternalEvaluation().catch((err) => {
  console.error('Fatal external evaluation error:', err)
  process.exit(1)
})
