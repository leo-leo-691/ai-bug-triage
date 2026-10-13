import './_guard.mjs'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function testCrud() {
  console.log('--- Testing Phase 2 Core CRUD ---')

  // 1. Create a test reporter user
  const testEmail = `tester-${Date.now()}@example.com`
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      name: 'Academic QA Tester',
      email: testEmail,
      role: 'reporter',
    })
    .select()
    .single()

  if (userError) {
    console.error('Failed to create test user:', userError.message)
    process.exit(1)
  }
  console.log('✓ Created test reporter:', user.email, `(id: ${user.id})`)

  // 2. Insert bug report with status 'new'
  const { data: bug, error: bugError } = await supabase
    .from('bug_reports')
    .insert({
      title: 'Memory leak when exporting large CSV reports',
      description: 'The browser tab freezes and memory consumption exceeds 2GB when exporting more than 50,000 records.',
      steps_to_reproduce: '1. Navigate to /reports\n2. Select date range > 1 year\n3. Click Export CSV\n4. Monitor browser RAM',
      reporter_id: user.id,
      status: 'new',
    })
    .select()
    .single()

  if (bugError) {
    console.error('Failed to insert bug report:', bugError.message)
    process.exit(1)
  }
  console.log('✓ Successfully inserted bug report with status "new":', bug.id)

  // 3. Insert audit log
  const { data: audit, error: auditError } = await supabase
    .from('audit_log')
    .insert({
      bug_id: bug.id,
      action: 'Bug report created via test script',
      actor: user.id,
    })
    .select()
    .single()

  if (auditError) {
    console.error('Failed to insert audit log:', auditError.message)
    process.exit(1)
  }
  console.log('✓ Successfully recorded audit log entry:', audit.action)

  // 4. Read back bug details with joins
  const { data: fetchedBug, error: fetchError } = await supabase
    .from('bug_reports')
    .select('*, reporter:users!reporter_id(name, email)')
    .eq('id', bug.id)
    .single()

  if (fetchError || !fetchedBug) {
    console.error('Failed to fetch bug details:', fetchError?.message)
    process.exit(1)
  }

  console.log('✓ Successfully fetched bug details:')
  console.log(`   Title: "${fetchedBug.title}"`)
  console.log(`   Status: "${fetchedBug.status}"`)
  console.log(`   Reporter: "${fetchedBug.reporter?.name}" <${fetchedBug.reporter?.email}>`)
  console.log('\n Phase 2 Core CRUD test PASSED successfully!')
}

testCrud()
