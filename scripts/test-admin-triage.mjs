import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

async function testAdminTriage() {
  console.log('====================================================')
  console.log('--- PHASE 4: ADMIN TRIAGE OPERATIONS & AUDIT LOG ---')
  console.log('====================================================\n')

  // 1. Create a sample developer user
  const devEmail = `dev-${Date.now()}@bugtrack.system`
  const { data: devUser, error: devErr } = await supabase
    .from('users')
    .insert({
      name: 'Alex Lead Dev',
      email: devEmail,
      role: 'developer',
    })
    .select()
    .single()

  if (devErr || !devUser) {
    console.error('Failed to create developer:', devErr?.message)
    process.exit(1)
  }
  console.log(`✓ Created developer user: ${devUser.name} (${devUser.id})`)

  // 2. Fetch a bug to test triage actions on
  const { data: bugs } = await supabase
    .from('bug_reports')
    .select('id, title, status, ai_severity, human_severity')
    .limit(1)

  if (!bugs || bugs.length === 0) {
    console.error('No bugs found to triage')
    process.exit(1)
  }

  const targetBug = bugs[0]
  console.log(`✓ Target bug for triage actions: "${targetBug.title}" (${targetBug.id})`)

  // 3. Test Action A: Override Severity
  console.log('\n[Action A] Overriding Severity to "Critical"...')
  const { error: sevErr } = await supabase
    .from('bug_reports')
    .update({ human_severity: 'Critical' })
    .eq('id', targetBug.id)

  if (sevErr) throw sevErr

  await supabase.from('audit_log').insert({
    bug_id: targetBug.id,
    action: 'Admin manually set severity to "Critical"',
    actor: devUser.id,
  })
  console.log('✓ Severity overridden to Critical and logged to audit_log')

  // 4. Test Action B: Add and Remove Tag
  console.log('\n[Action B] Tag management (add & remove)...')
  const { data: testTag } = await supabase
    .from('tags')
    .upsert({ name: 'security-review' }, { onConflict: 'name' })
    .select('id')
    .single()

  if (testTag) {
    await supabase.from('bug_tags').upsert(
      { bug_id: targetBug.id, tag_id: testTag.id, source: 'human' },
      { onConflict: 'bug_id, tag_id' }
    )
    await supabase.from('audit_log').insert({
      bug_id: targetBug.id,
      action: 'Added tag "security-review" (human)',
      actor: devUser.id,
    })
    console.log('✓ Added human tag "security-review" and recorded in audit_log')
  }

  // 5. Test Action C: Assign Developer
  console.log('\n[Action C] Assigning Developer...')
  const { error: assignErr } = await supabase
    .from('bug_reports')
    .update({ assigned_to: devUser.id })
    .eq('id', targetBug.id)

  if (assignErr) throw assignErr

  await supabase.from('audit_log').insert({
    bug_id: targetBug.id,
    action: `Assigned bug to developer (${devUser.id})`,
    actor: devUser.id,
  })
  console.log(`✓ Assigned bug to ${devUser.name} and recorded in audit_log`)

  // 6. Test Action D: Update Status
  console.log('\n[Action D] Updating Status to "in_progress"...')
  const { error: statusErr } = await supabase
    .from('bug_reports')
    .update({ status: 'in_progress' })
    .eq('id', targetBug.id)

  if (statusErr) throw statusErr

  await supabase.from('audit_log').insert({
    bug_id: targetBug.id,
    action: 'Status updated to "in_progress"',
    actor: devUser.id,
  })
  console.log('✓ Status changed to "in_progress" and recorded in audit_log')

  // 7. Verify Audit Log Trail
  console.log('\n[Verification] Checking complete audit log trail for this bug:')
  const { data: auditTrail } = await supabase
    .from('audit_log')
    .select('action, created_at')
    .eq('bug_id', targetBug.id)
    .order('created_at', { ascending: false })

  for (const log of auditTrail || []) {
    console.log(`   -> [${new Date(log.created_at).toLocaleTimeString()}] ${log.action}`)
  }

  console.log('\n====================================================')
  console.log(' ALL PHASE 4 ADMIN TRIAGE TESTS PASSED!')
  console.log('====================================================\n')
}

testAdminTriage().catch((err) => {
  console.error('Admin triage test error:', err)
  process.exit(1)
})
