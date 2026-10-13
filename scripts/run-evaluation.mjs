import './_guard.mjs'
import { createClient } from '@supabase/supabase-js'
import { orchestrateBugTriage } from '../lib/ai-orchestrator.ts'
import fs from 'fs'
import path from 'path'

// Fall back to demo mode only if neither Gemini nor OpenAI keys are configured
if (process.env.USE_DEMO_AI === undefined && !process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
  process.env.USE_DEMO_AI = 'true'
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

/**
 * Hand-labeled Test Set
 * Contains ground-truth severities, 2 duplicate pairs, and 2 intentionally vague bugs.
 */
export const TEST_SET = [
  {
    id: 1,
    title: 'Application crashes and all unsaved data is lost when clicking Save',
    description: 'Clicking the save button causes an immediate crash; nothing is persisted and the session must be restarted',
    expectedSeverity: 'Critical',
    expectedDuplicateOf: null,
  },
  {
    id: 2,
    title: 'SQL injection vulnerability in login form',
    description: 'The login form does not sanitize input, allowing crafted queries to access unauthorized database records',
    expectedSeverity: 'Critical',
    expectedDuplicateOf: null,
  },
  {
    id: 3,
    title: 'Payment processing charges customers twice for a single transaction',
    description: 'Users report duplicate charges appearing on their card statement after a single checkout',
    expectedSeverity: 'Critical',
    expectedDuplicateOf: null,
  },
  {
    id: 4,
    title: 'Server crashes completely when more than 50 users log in simultaneously',
    description: 'Load testing shows a full server crash and downtime once concurrent logins exceed 50',
    expectedSeverity: 'Critical',
    expectedDuplicateOf: null,
  },
  {
    id: 5,
    title: 'Clicking save button crashes the app and wipes unsaved changes',
    description: 'Same crash-on-save behavior as reported elsewhere; all in-progress edits are lost',
    expectedSeverity: 'Critical',
    expectedDuplicateOf: 1, // Duplicate of #1
  },
  {
    id: 6,
    title: 'Checkout page freezes when applying a discount code',
    description: 'Clicking "Apply Promo Code" causes a 500 error and the browser tab becomes unresponsive',
    expectedSeverity: 'High',
    expectedDuplicateOf: null,
  },
  {
    id: 7,
    title: 'User passwords visible in plain text in browser network requests',
    description: 'Inspecting network traffic during login shows the password field unencrypted in the request payload',
    expectedSeverity: 'High',
    expectedDuplicateOf: null,
  },
  {
    id: 8,
    title: 'File upload fails for all files larger than 10MB with no error message',
    description: 'Large uploads silently fail; the UI shows a spinner indefinitely with no feedback to the user',
    expectedSeverity: 'High',
    expectedDuplicateOf: null,
  },
  {
    id: 9,
    title: 'Search results return incorrect data for about 30% of queries',
    description: 'A sample of 20 test queries showed 6 returning results unrelated to the search term',
    expectedSeverity: 'High',
    expectedDuplicateOf: null,
  },
  {
    id: 10,
    title: 'Discount code entry causes checkout to hang and become unresponsive',
    description: 'Applying a promo code at checkout freezes the page, matching other reports of checkout instability',
    expectedSeverity: 'High',
    expectedDuplicateOf: 6, // Duplicate of #6
  },
  {
    id: 11,
    title: 'Profile picture upload sometimes takes over 30 seconds to complete',
    description: 'Upload works but is unusually slow under normal network conditions, no data loss',
    expectedSeverity: 'Medium',
    expectedDuplicateOf: null,
  },
  {
    id: 12,
    title: 'Email notifications delayed by several hours during peak usage',
    description: 'Notification emails are eventually delivered but with a multi-hour lag during high-traffic periods',
    expectedSeverity: 'Medium',
    expectedDuplicateOf: null,
  },
  {
    id: 13,
    title: 'Dashboard chart labels overlap on tablet-sized screens',
    description: 'Chart legends visually overlap between 768px-1024px viewport widths; desktop and mobile are unaffected',
    expectedSeverity: 'Medium',
    expectedDuplicateOf: null,
  },
  {
    id: 14,
    title: 'Export to CSV produces a file with incorrect column headers',
    description: 'The exported file has data in the right order but header row labels are shifted by one column',
    expectedSeverity: 'Medium',
    expectedDuplicateOf: null,
  },
  {
    id: 15,
    title: "Submit button color doesn't match the rest of the UI theme",
    description: 'Minor visual inconsistency; button is functional, just the wrong shade of blue',
    expectedSeverity: 'Low',
    expectedDuplicateOf: null,
  },
  {
    id: 16,
    title: 'Typo in the settings page: "Recieve" should be "Receive"',
    description: 'Cosmetic spelling error in static text, no functional impact',
    expectedSeverity: 'Low',
    expectedDuplicateOf: null,
  },
  {
    id: 17,
    title: 'Tooltip text is slightly misaligned on hover for the help icon',
    description: "Tooltip appears a few pixels off from the icon it's attached to",
    expectedSeverity: 'Low',
    expectedDuplicateOf: null,
  },
  {
    id: 18,
    title: 'Footer copyright year shows last year instead of current year',
    description: 'Static text bug, purely cosmetic, no functional impact',
    expectedSeverity: 'Low',
    expectedDuplicateOf: null,
  },
  {
    id: 19,
    title: 'Something feels off with the reports page, not sure what exactly',
    description: 'Vague report with no specific symptom, error, or reproduction steps described',
    expectedSeverity: 'Ambiguous',
    expectedDuplicateOf: null,
    isAmbiguous: true,
  },
  {
    id: 20,
    title: "App seems slower than before but can't pinpoint when it started",
    description: 'No specific page, action, or timeframe identified; purely anecdotal',
    expectedSeverity: 'Ambiguous',
    expectedDuplicateOf: null,
    isAmbiguous: true,
  },
]

async function runEvaluation() {
  console.log('===============================================================')
  console.log('--- AI ORCHESTRATOR ACCURACY & EVALUATION BENCHMARK SUITE ---')
  console.log('===============================================================\n')
  console.log(`Evaluating test set: ${TEST_SET.length} bug reports`)
  console.log('Measuring Severity Classification Accuracy, Confusion Matrix, pgvector Duplicate Detection, and Confidence Guardrails.\n')

  const insertedBugIdMap = new Map() // testId -> Supabase UUID
  const evaluationRecords = []

  // Reset database before benchmark run to ensure clean isolated precision/recall
  console.log('Resetting database test records for an isolated benchmark run...')
  await supabase.from('duplicate_links').delete().neq('similarity_score', -1)
  await supabase.from('bug_tags').delete().neq('source', 'none')
  await supabase.from('audit_log').delete().neq('action', 'none')
  await supabase.from('bug_reports').delete().neq('status', 'none')

  for (const item of TEST_SET) {
    process.stdout.write(`Evaluating Bug #${item.id.toString().padStart(2, '0')}: "${item.title.slice(0, 45)}..." `)

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

    insertedBugIdMap.set(item.id, bugRow.id)

    // 2. Run through orchestrateBugTriage() exactly as in production
    const triageResult = await orchestrateBugTriage(bugRow.id, {
      title: item.title,
      description: item.description,
    })

    // 3. Fetch duplicate links created in Supabase for this bug
    const { data: dupLinks } = await supabase
      .from('duplicate_links')
      .select('duplicate_of_bug_id, similarity_score')
      .eq('bug_id', bugRow.id)

    // Check if expected duplicate was matched
    let duplicateMatched = false
    let matchedBugId = null
    let similarityScore = null

    if (item.expectedDuplicateOf) {
      const expectedUUID = insertedBugIdMap.get(item.expectedDuplicateOf)
      const foundLink = dupLinks?.find((d) => d.duplicate_of_bug_id === expectedUUID)
      if (foundLink) {
        duplicateMatched = true
        matchedBugId = foundLink.duplicate_of_bug_id
        similarityScore = foundLink.similarity_score
      }
    }

    const actualSeverity = triageResult.severity.severity
    const confidence = triageResult.severity.confidence
    const status = triageResult.appliedStatus
    const flagDuplicatesCount = dupLinks?.length || 0

    evaluationRecords.push({
      id: item.id,
      title: item.title,
      expectedSeverity: item.expectedSeverity,
      actualSeverity,
      confidence,
      status,
      isAmbiguous: Boolean(item.isAmbiguous),
      expectedDuplicateOf: item.expectedDuplicateOf,
      actualDuplicateDetected: duplicateMatched,
      flaggedAsDuplicate: flagDuplicatesCount > 0,
      matchedBugId,
      similarityScore,
      tags: triageResult.tags,
    })

    console.log(`➔ [${actualSeverity}] (conf: ${confidence.toFixed(2)}, status: ${status})`)
  }

  // =========================================================================
  // METRICS COMPUTATION
  // =========================================================================

  const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low']

  // 1. Classification Accuracy (Excluding Ambiguous)
  const classificationBugs = evaluationRecords.filter((r) => !r.isAmbiguous)
  let correctSeverityCount = 0

  for (const r of classificationBugs) {
    if (r.actualSeverity.toLowerCase() === r.expectedSeverity.toLowerCase()) {
      correctSeverityCount++
    }
  }

  const accuracy = (correctSeverityCount / classificationBugs.length) * 100

  // 2. Confusion Matrix (Rows = Expected, Columns = Actual)
  const confusionMatrix = {}
  for (const exp of SEVERITY_LEVELS) {
    confusionMatrix[exp] = {}
    for (const act of SEVERITY_LEVELS) {
      confusionMatrix[exp][act] = 0
    }
  }

  for (const r of classificationBugs) {
    if (confusionMatrix[r.expectedSeverity] && confusionMatrix[r.expectedSeverity][r.actualSeverity] !== undefined) {
      confusionMatrix[r.expectedSeverity][r.actualSeverity]++
    }
  }

  // 3. Duplicate Detection Precision & Recall
  // Bugs expected to be duplicates: expectedDuplicateOf !== null
  let truePositives = 0
  let falsePositives = 0
  let falseNegatives = 0

  for (const r of evaluationRecords) {
    const isExpectedDuplicate = r.expectedDuplicateOf !== null
    const wasFlagged = r.flaggedAsDuplicate

    if (isExpectedDuplicate && wasFlagged) {
      truePositives++
    } else if (!isExpectedDuplicate && wasFlagged) {
      falsePositives++
    } else if (isExpectedDuplicate && !wasFlagged) {
      falseNegatives++
    }
  }

  const precision = truePositives + falsePositives > 0 ? (truePositives / (truePositives + falsePositives)) * 100 : 0
  const recall = truePositives + falseNegatives > 0 ? (truePositives / (truePositives + falseNegatives)) * 100 : 0
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  // 4. Confidence Threshold Check (Ambiguous Bugs)
  const ambiguousBugs = evaluationRecords.filter((r) => r.isAmbiguous)
  const ambiguousPassed = ambiguousBugs.every((r) => r.status === 'pending_review' && r.confidence < 0.6)

  // =========================================================================
  // DISPLAY RESULTS TABLE
  // =========================================================================

  console.log('\n===============================================================')
  console.log('                  EVALUATION BENCHMARK RESULTS                 ')
  console.log('===============================================================\n')

  console.log('--- DETAILED PER-BUG PREDICTIONS ---')
  console.table(
    evaluationRecords.map((r) => ({
      ID: r.id,
      Title: r.title.slice(0, 32) + '...',
      'Exp. Severity': r.expectedSeverity,
      'Act. Severity': r.actualSeverity,
      Confidence: r.confidence.toFixed(2),
      Status: r.status,
      'Exp. Dup': r.expectedDuplicateOf ? `#${r.expectedDuplicateOf}` : 'None',
      'Dup Match': r.actualDuplicateDetected ? '✓ MATCH' : r.expectedDuplicateOf ? '✗ MISS' : '-',
    }))
  )

  console.log('\n--- CONFUSION MATRIX (Rows = Expected, Columns = Actual) ---')
  console.table(confusionMatrix)

  console.log('--- KEY PERFORMANCE METRICS ---')
  console.log(`• Overall Severity Classification Accuracy : ${accuracy.toFixed(1)}% (${correctSeverityCount}/${classificationBugs.length} correct)`)
  console.log(`• Duplicate Detection Precision            : ${precision.toFixed(1)}% (TP: ${truePositives}, FP: ${falsePositives})`)
  console.log(`• Duplicate Detection Recall               : ${recall.toFixed(1)}% (TP: ${truePositives}, FN: ${falseNegatives})`)
  console.log(`• Duplicate Detection F1-Score             : ${f1Score.toFixed(1)}%`)
  console.log(`• Confidence Threshold Check (< 0.6 Guard) : ${ambiguousPassed ? '✓ ALL AMBIGUOUS BUGS ROUTED TO pending_review' : '✗ FAILED'}`)
  for (const amb of ambiguousBugs) {
    console.log(`    - Bug #${amb.id}: Status="${amb.status}", Confidence=${amb.confidence.toFixed(2)} (Expected pending_review)`)
  }

  // =========================================================================
  // WRITE RESULTS TO scripts/evaluation-results.json
  // =========================================================================
  const outputPayload = {
    evaluatedAt: new Date().toISOString(),
    totalSamples: evaluationRecords.length,
    classificationSamples: classificationBugs.length,
    accuracyPercentage: Number(accuracy.toFixed(2)),
    correctPredictions: correctSeverityCount,
    confusionMatrix,
    duplicateDetection: {
      precisionPercentage: Number(precision.toFixed(2)),
      recallPercentage: Number(recall.toFixed(2)),
      f1Score: Number(f1Score.toFixed(2)),
      truePositives,
      falsePositives,
      falseNegatives,
    },
    confidenceThresholdCheck: {
      passed: ambiguousPassed,
      targetStatus: 'pending_review',
      ambiguousBugs: ambiguousBugs.map((b) => ({
        id: b.id,
        title: b.title,
        confidence: b.confidence,
        appliedStatus: b.status,
      })),
    },
    sampleRecords: evaluationRecords,
  }

  const outputPath = path.join(process.cwd(), 'scripts', 'evaluation-results.json')
  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8')
  console.log(`\n✓ Successfully exported exact numerical results to: ${outputPath}`)
  console.log('===============================================================\n')
  return outputPayload;
}

import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runEvaluation().catch((err) => {
    console.error('Fatal evaluation error:', err)
    process.exit(1)
  })
}

export { runEvaluation };
