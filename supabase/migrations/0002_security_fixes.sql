-- 0002_security_fixes
-- Applies on top of 0001_init (the live baseline). Additive and idempotent where
-- practical; no tables or data are dropped. Runs in a single transaction under
-- `supabase db push`.

-- =============================================================================
-- 1. Profiles: backfill missing rows and create them automatically on signup
-- =============================================================================

-- 1a. Backfill: one public.users row (role 'reporter') for every auth user without
--     one. Existing rows are never touched. ON CONFLICT DO NOTHING (no target) also
--     skips an auth user whose email is already taken by a different public.users
--     row (e.g. one created by the old anonymous submission path); those are
--     reported by the NOTICE below for manual review.
insert into public.users (id, email, name, role)
select
  au.id,
  au.email,
  coalesce(nullif(au.raw_user_meta_data->>'name', ''), split_part(au.email, '@', 1)),
  'reporter'
from auth.users au
where not exists (select 1 from public.users u where u.id = au.id)
on conflict do nothing;

do $$
declare
  remaining int;
begin
  select count(*) into remaining
  from auth.users au
  where not exists (select 1 from public.users u where u.id = au.id);
  if remaining > 0 then
    raise notice '0002: % auth user(s) still have no profile (email already used by another public.users row). Review manually.', remaining;
  end if;
end $$;

-- 1b. Trigger: create the profile server-side when an auth user is created.
--     Role is always 'reporter'; client-supplied metadata cannot set it.
--     ON CONFLICT DO NOTHING so a collision can never block the signup itself.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    'reporter'
  )
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- 2. users policies: only admins change roles; no client-side profile inserts
-- =============================================================================

-- H1: previously any developer could update any row, including role.
drop policy if exists "Admins can update user roles" on public.users;
drop policy if exists "Admins can update users" on public.users;
create policy "Admins can update users"
  on public.users for update
  to authenticated
  using ( public.current_user_role() = 'admin' )
  with check ( public.current_user_role() = 'admin' );

-- Profiles are now created only by the trigger above.
drop policy if exists "Users can insert self as reporter only" on public.users;

-- =============================================================================
-- 3. bug_reports: authenticated reporters insert only their own, untriaged rows
-- =============================================================================

-- H2: previously anon could insert rows with reporter_id null and any column values.
drop policy if exists "Reporters insert own bugs" on public.bug_reports;
create policy "Reporters insert own bugs"
  on public.bug_reports for insert
  to authenticated
  with check (
    auth.uid() = reporter_id
    and status = 'new'
    and ai_severity is null
    and ai_confidence is null
    and human_severity is null
    and assigned_to is null
    and embedding is null
  );

drop policy if exists "Staff can update bug_reports" on public.bug_reports;
create policy "Staff can update bug_reports"
  on public.bug_reports for update
  to authenticated
  using ( public.current_user_role() in ('admin', 'developer') )
  with check ( public.current_user_role() in ('admin', 'developer') );

-- Severity integrity (H4). NOT VALID: enforced for new/updated rows without failing
-- on any legacy values already stored. Check legacy rows with:
--   select id, ai_severity, human_severity, ai_confidence from public.bug_reports
--   where ai_severity not in ('Critical','High','Medium','Low')
--      or human_severity not in ('Critical','High','Medium','Low')
--      or ai_confidence not between 0 and 1;
-- then run: alter table public.bug_reports validate constraint <name>;
alter table public.bug_reports drop constraint if exists bug_reports_ai_severity_check;
alter table public.bug_reports add constraint bug_reports_ai_severity_check
  check (ai_severity in ('Critical', 'High', 'Medium', 'Low')) not valid;

alter table public.bug_reports drop constraint if exists bug_reports_human_severity_check;
alter table public.bug_reports add constraint bug_reports_human_severity_check
  check (human_severity in ('Critical', 'High', 'Medium', 'Low')) not valid;

alter table public.bug_reports drop constraint if exists bug_reports_ai_confidence_check;
alter table public.bug_reports add constraint bug_reports_ai_confidence_check
  check (ai_confidence between 0 and 1) not valid;

-- Severity rank for server-side sorting/pagination of the triage queue (H8).
alter table public.bug_reports
  add column if not exists severity_rank smallint
  generated always as (
    case coalesce(human_severity, ai_severity)
      when 'Critical' then 4
      when 'High' then 3
      when 'Medium' then 2
      when 'Low' then 1
      else 0
    end
  ) stored;

-- Which model produced the embedding, so duplicates are only compared within one
-- embedding space (M4). Existing vectors are left untagged (NULL) and are excluded
-- from duplicate matching.
alter table public.bug_reports add column if not exists embedding_model text;

-- =============================================================================
-- 4. tags / bug_tags / audit_log
-- =============================================================================

-- H2: tag inserts were open to anyone (with check (true)).
drop policy if exists "Staff insert tags" on public.tags;
create policy "Staff insert tags"
  on public.tags for insert
  to authenticated
  with check ( public.current_user_role() in ('admin', 'developer') );

-- Needed for upsert (INSERT ... ON CONFLICT DO UPDATE) from the triage API.
drop policy if exists "Staff update tags" on public.tags;
create policy "Staff update tags"
  on public.tags for update
  to authenticated
  using ( public.current_user_role() in ('admin', 'developer') )
  with check ( public.current_user_role() in ('admin', 'developer') );

drop policy if exists "Public read tags" on public.tags;
drop policy if exists "Authenticated read tags" on public.tags;
create policy "Authenticated read tags"
  on public.tags for select
  to authenticated
  using (true);

-- bug_tags were readable by anyone; now only for bugs the caller can see.
drop policy if exists "Read bug_tags" on public.bug_tags;
drop policy if exists "Read bug_tags for visible bugs" on public.bug_tags;
create policy "Read bug_tags for visible bugs"
  on public.bug_tags for select
  to authenticated
  using ( exists (select 1 from public.bug_reports b where b.id = bug_tags.bug_id) );

-- REMOVE_TAG in the triage API (there was no delete policy).
drop policy if exists "Staff delete bug_tags" on public.bug_tags;
create policy "Staff delete bug_tags"
  on public.bug_tags for delete
  to authenticated
  using ( public.current_user_role() in ('admin', 'developer') );

-- Staff actions are now written with the session client; actor must be the caller.
drop policy if exists "Staff insert own audit entries" on public.audit_log;
create policy "Staff insert own audit entries"
  on public.audit_log for insert
  to authenticated
  with check (
    public.current_user_role() in ('admin', 'developer')
    and actor = auth.uid()
  );

-- =============================================================================
-- 5. rate_limits: per-user limiting
-- =============================================================================

alter table public.rate_limits add column if not exists user_id uuid;

-- =============================================================================
-- 6. Duplicate search: index-friendly, model-scoped, server-only
-- =============================================================================

drop function if exists public.match_bug_reports(vector, float, int);

create or replace function public.match_bug_reports (
  query_embedding vector(1536),
  match_threshold float default 0.85,
  match_count int default 5,
  embedding_model_filter text default null,
  exclude_id uuid default null
)
returns table (
  id uuid,
  title text,
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  -- Inner ORDER BY distance + LIMIT lets the HNSW index serve the query;
  -- the similarity threshold is applied to that small candidate set.
  select c.id, c.title, c.similarity
  from (
    select
      b.id,
      b.title,
      1 - (b.embedding <=> query_embedding) as similarity
    from public.bug_reports b
    where b.embedding is not null
      and b.embedding_model is not distinct from embedding_model_filter
      and (exclude_id is null or b.id <> exclude_id)
    order by b.embedding <=> query_embedding
    limit least(greatest(match_count, 1), 20)
  ) c
  where c.similarity > match_threshold
  order by c.similarity desc;
$$;

revoke execute on function public.match_bug_reports(vector, float, int, text, uuid) from public, anon, authenticated;
grant execute on function public.match_bug_reports(vector, float, int, text, uuid) to service_role;

-- =============================================================================
-- 7. Indexes (M5)
-- =============================================================================

create index if not exists bug_reports_status_idx on public.bug_reports (status);
create index if not exists bug_reports_created_at_idx on public.bug_reports (created_at desc);
create index if not exists bug_reports_reporter_id_idx on public.bug_reports (reporter_id);
create index if not exists bug_reports_assigned_to_idx on public.bug_reports (assigned_to);
create index if not exists bug_reports_triage_order_idx on public.bug_reports (severity_rank desc, created_at desc);
create index if not exists bug_reports_embedding_hnsw_idx
  on public.bug_reports using hnsw (embedding vector_cosine_ops);
create index if not exists audit_log_bug_id_created_at_idx on public.audit_log (bug_id, created_at desc);
create index if not exists duplicate_links_duplicate_of_idx on public.duplicate_links (duplicate_of_bug_id);
create index if not exists bug_tags_tag_id_idx on public.bug_tags (tag_id);
create index if not exists rate_limits_ip_created_idx on public.rate_limits (ip_address, created_at);
create index if not exists rate_limits_user_created_idx on public.rate_limits (user_id, created_at);
create index if not exists rate_limits_created_at_idx on public.rate_limits (created_at);

-- =============================================================================
-- 8. Table privileges: the app never queries as anon; TRUNCATE bypasses RLS
-- =============================================================================

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke all on public.rate_limits from authenticated;
