import './_guard.mjs'
import { createClient } from '@supabase/supabase-js'
import { orchestrateBugTriage, generateEmbedding } from '../lib/ai-orchestrator.ts'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function testSingleBug() {
  console.log('===============================================================')
  console.log('--- TESTING SINGLE BUG THROUGH LIVE GEMINI AI ORCHESTRATOR ---')
  console.log('===============================================================\n')

  const testTitle = 'Application crashes and all unsaved data is lost when clicking Save'
  const testDesc = 'Clicking the save button causes an immediate crash; nothing is persisted and the session must be restarted'
  const testSteps = '1. Open editor\n2. Type document\n3. Click Save button\n4. Observe crash'

  console.log(`Submitting Bug: "${testTitle}"`)
  console.log(`Description: "${testDesc}"\n`)

  // 1. Insert bug into Supabase
  const { data: bug, error: insertErr } = await supabase
    .from('bug_reports')
    .insert({
      title: testTitle,
      description: testDesc,
      steps_to_reproduce: testSteps,
      status: 'new',
    })
    .select()
    .single()

  if (insertErr || !bug) {
    console.error('Failed to insert test bug:', insertErr)
    process.exit(1)
  }

  console.log(`✓ Inserted Bug in Supabase: ${bug.id} (initial status: "${bug.status}")`)
  console.log('➔ Calling orchestrateBugTriage() with Gemini API...\n')

  const start = Date.now()
  const triageResult = await orchestrateBugTriage(bug.id, {
    title: bug.title,
    description: bug.description,
    steps_to_reproduce: bug.steps_to_reproduce,
  })
  const duration = Date.now() - start

  console.log('--- GEMINI ORCHESTRATION RESULT ---')
  console.log(`• Assigned Severity : ${triageResult.severity.severity}`)
  console.log(`• Model Confidence  : ${triageResult.severity.confidence} (${(triageResult.severity.confidence * 100).toFixed(1)}%)`)
  console.log(`• Model Rationale   : "${triageResult.severity.reason}"`)
  console.log(`• Suggested Tags    : [${triageResult.tags.join(', ')}]`)
  console.log(`• Applied Status    : "${triageResult.appliedStatus}"`)
  console.log(`• Duplicate Matches : ${triageResult.duplicates.length} match(es)`)
  console.log(`• Execution Time    : ${duration}ms`)

  // Fetch updated bug record and embedding from Supabase
  const { data: updatedBug } = await supabase
    .from('bug_reports')
    .select('id, status, ai_severity, ai_confidence, embedding')
    .eq('id', bug.id)
    .single()

  console.log('\n--- SUPABASE RECORD VERIFICATION ---')
  console.log(`• DB Status        : ${updatedBug?.status}`)
  console.log(`• DB AI Severity   : ${updatedBug?.ai_severity}`)
  console.log(`• DB AI Confidence : ${updatedBug?.ai_confidence}`)
  console.log(`• DB Embedding Dims: ${updatedBug?.embedding ? JSON.parse(updatedBug.embedding).length : 'None'}`)

  console.log('\n===============================================================')
  console.log('✓ GEMINI API CALL VERIFIED SUCCESSFULLY!')
  console.log('===============================================================\n')
}

testSingleBug().catch((err) => {
  console.error('Single bug test error:', err)
  process.exit(1)
})
