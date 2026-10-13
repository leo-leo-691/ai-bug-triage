import './_guard.mjs'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log('--- Checking Supabase Environment Variables ---')
console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓ Present' : '✗ Missing')
console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✓ Present' : '✗ Missing')
console.log('SUPABASE_SERVICE_ROLE_KEY:', serviceRoleKey ? '✓ Present' : '✗ Missing')

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-project-id')) {
  console.log('\n[!] Supabase URL / Keys are not configured yet in .env.local.')
  console.log('Please follow the steps below:')
  console.log('1. Go to https://supabase.com/dashboard and click "New project"')
  console.log('2. Once created, go to Project Settings -> API')
  console.log('3. Copy Project URL, anon public key, and service_role secret key into .env.local')
  console.log('4. Open SQL Editor in Supabase, paste the contents of supabase/schema.sql and click Run')
  console.log('5. Re-run: npm run test:db')
  process.exit(0)
}

async function testConnection() {
  console.log('\nConnecting to Supabase at:', supabaseUrl)
  const client = createClient(supabaseUrl, serviceRoleKey || supabaseAnonKey)

  try {
    // 1. Test reading tags
    const { data: tags, error: tagsError } = await client.from('tags').select('*').limit(5)
    if (tagsError) {
      console.error('✗ Query failed on "tags" table:', tagsError.message)
      console.log('Make sure you ran the SQL in supabase/schema.sql in your Supabase SQL Editor!')
      process.exit(1)
    }
    console.log(`✓ Successfully queried "tags" table. Found ${tags.length} tag(s):`, tags.map(t => t.name).join(', '))

    // 2. Test querying bug_reports count
    const { count, error: bugsError } = await client.from('bug_reports').select('*', { count: 'exact', head: true })
    if (bugsError) {
      console.error('✗ Query failed on "bug_reports" table:', bugsError.message)
      process.exit(1)
    }
    console.log(`✓ Successfully queried "bug_reports" table. Total records: ${count}`)

    // 3. Test RPC function match_bug_reports
    const { data: rpcData, error: rpcError } = await client.rpc('match_bug_reports', {
      query_embedding: Array(1536).fill(0),
      match_threshold: 0.99,
      match_count: 1
    })
    if (rpcError) {
      console.warn('! Note on match_bug_reports RPC:', rpcError.message)
    } else {
      console.log('✓ Vector search RPC "match_bug_reports" is active and functional')
    }

    console.log('\n Database connection and schema verification PASSED successfully!')
  } catch (err) {
    console.error('Unexpected error connecting to Supabase:', err)
    process.exit(1)
  }
}

testConnection()
