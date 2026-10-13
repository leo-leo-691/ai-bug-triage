-- READ-ONLY. Identifies rows written by scripts/*.mjs (test/eval data) so they can be
-- reviewed before any cleanup. Contains no INSERT/UPDATE/DELETE. Run in the SQL editor.
--
-- Markers used:
--  * The app's POST /api/bugs always writes an audit_log row 'Bug report submitted by reporter'.
--    Scripts insert bug_reports directly, so their bugs never have that row.
--  * Script-created users: tester-<ts>@example.com (test-crud), dev-<ts>@bugtrack.system
--    (test-admin-triage); none of them exist in auth.users.
--  * Script-only audit actions and the 'security-review' tag (test-admin-triage).

-- 1. Bug reports with no app-submission audit row (likely script/eval inserts)
select b.id, b.title, b.status, b.ai_severity, b.reporter_id, b.created_at,
       exists (select 1 from public.users u where u.id = b.reporter_id
               and (u.email like 'tester-%@example.com' or u.email like 'dev-%@bugtrack.system')) as reporter_is_test_user
from public.bug_reports b
where not exists (
  select 1 from public.audit_log a
  where a.bug_id = b.id and a.action = 'Bug report submitted by reporter'
)
order by b.created_at;

-- 2. Users created by scripts, and any public.users rows with no matching auth account
select u.id, u.name, u.email, u.role, u.created_at,
       (u.email like 'tester-%@example.com' or u.email like 'dev-%@bugtrack.system') as script_email_pattern,
       not exists (select 1 from auth.users au where au.id = u.id) as no_auth_account
from public.users u
where u.email like 'tester-%@example.com'
   or u.email like 'dev-%@bugtrack.system'
   or not exists (select 1 from auth.users au where au.id = u.id)
order by u.created_at;

-- 3. Tags outside the standard seed list, with usage counts (AI-created during evals or by scripts)
select t.id, t.name, count(bt.bug_id) as bug_count
from public.tags t
left join public.bug_tags bt on bt.tag_id = t.id
where t.name not in ('ui','backend','auth','payment','performance','crash','data-loss')
group by t.id, t.name
order by bug_count desc, t.name;

-- 4. Audit log rows written by scripts, or attached to bugs from query 1
select a.id, a.bug_id, a.action, a.actor, a.created_at
from public.audit_log a
where a.action = 'Bug report created via test script'
   or a.actor in (select id from public.users
                  where email like 'tester-%@example.com' or email like 'dev-%@bugtrack.system')
   or a.bug_id in (
     select b.id from public.bug_reports b
     where not exists (select 1 from public.audit_log a2
                       where a2.bug_id = b.id and a2.action = 'Bug report submitted by reporter'))
order by a.created_at;

-- 5. rate_limits: scripts never write here; every row comes from real POST /api/bugs calls.
--    Shown for completeness (counts per IP, all rows are safe to expire after 10 minutes).
select ip_address, count(*) as hits, min(created_at) as first_seen, max(created_at) as last_seen
from public.rate_limits
group by ip_address
order by hits desc;
