-- !!! DESTRUCTIVE: DROPS ALL APP TABLES AND DATA. LOCAL/DEV DATABASES ONLY. !!!
-- Never run against production. The source of truth is supabase/migrations/.
-- After running this on a local DB, also apply supabase/migrations/0002_*.sql and later.

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Drop existing tables if re-running migration
drop table if exists audit_log cascade;
drop table if exists duplicate_links cascade;
drop table if exists bug_tags cascade;
drop table if exists tags cascade;
drop table if exists bug_reports cascade;
drop table if exists users cascade;

-- 3. Users table
create table users (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  role text check (role in ('reporter', 'admin', 'developer')),
  created_at timestamptz default now()
);

-- 4. Bug Reports table
create table bug_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  steps_to_reproduce text,
  reporter_id uuid references users(id) on delete set null,
  status text default 'new' check (
    status in ('new', 'pending_triage', 'pending_review', 'triaged', 'in_progress', 'resolved', 'closed')
  ),
  ai_severity text,
  ai_confidence float,
  human_severity text,
  assigned_to uuid references users(id) on delete set null,
  embedding vector(1536),
  created_at timestamptz default now()
);

-- 5. Tags table
create table tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

-- 6. Bug Tags table (junction)
create table bug_tags (
  bug_id uuid references bug_reports(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  source text check (source in ('ai', 'human')),
  primary key (bug_id, tag_id)
);

-- 7. Duplicate Links table
create table duplicate_links (
  bug_id uuid references bug_reports(id) on delete cascade,
  duplicate_of_bug_id uuid references bug_reports(id) on delete cascade,
  similarity_score float,
  confirmed boolean default null,
  primary key (bug_id, duplicate_of_bug_id)
);

-- 8. Audit Log table
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  bug_id uuid references bug_reports(id) on delete cascade,
  action text not null,
  actor uuid references users(id) on delete set null,
  created_at timestamptz default now()
);

-- 9. Vector search RPC for duplicate detection (> 0.85 cosine similarity)
create or replace function match_bug_reports (
  query_embedding vector(1536),
  match_threshold float default 0.85,
  match_count int default 5
)
returns table (
  id uuid,
  title text,
  description text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    b.id,
    b.title,
    b.description,
    1 - (b.embedding <=> query_embedding) as similarity
  from bug_reports b
  where b.embedding is not null
    and (1 - (b.embedding <=> query_embedding)) > match_threshold
  order by similarity desc
  limit match_count;
end;
$$;

-- 10. Enable Row Level Security (RLS)
alter table users enable row level security;
alter table bug_reports enable row level security;
alter table tags enable row level security;
alter table bug_tags enable row level security;
alter table duplicate_links enable row level security;
alter table audit_log enable row level security;

-- Helper function to check current user's role
create or replace function current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from users where id = auth.uid() limit 1;
$$;

-- RLS Policies on bug_reports
-- Reporter can only select their own bug reports
-- Admin and developer can select all
create policy "Reporters select own bugs or staff select all"
  on bug_reports for select
  using (
    auth.uid() = reporter_id 
    or current_user_role() in ('admin', 'developer')
    or auth.role() = 'service_role'
  );

-- Anyone can submit (or reporter can insert)
create policy "Reporters insert own bugs" on bug_reports for insert
  with check ( auth.uid() = reporter_id or reporter_id is null or auth.role() = 'service_role' );

-- Admins and developers can update bug reports
create policy "Staff can update bug_reports"
  on bug_reports for update
  using (
    current_user_role() in ('admin', 'developer')
    or auth.role() = 'service_role'
  );

-- Policies for other tables to ensure smooth operation
create policy "Public read tags" on tags for select using (true);
create policy "Staff insert tags" on tags for insert with check (true);

create policy "Read bug_tags" on bug_tags for select using (true);
create policy "Staff manage bug_tags" on bug_tags for insert
  with check ( current_user_role() in ('admin','developer') or auth.role() = 'service_role' );
create policy "Staff update bug_tags" on bug_tags for update
  using ( current_user_role() in ('admin','developer') or auth.role() = 'service_role' );

create policy "Staff read duplicate_links" on duplicate_links for select using (
  exists (select 1 from bug_reports where id = duplicate_links.bug_id)
);
create policy "Staff manage duplicate_links" on duplicate_links for all
  using ( current_user_role() in ('admin','developer') or auth.role() = 'service_role' )
  with check ( current_user_role() in ('admin','developer') or auth.role() = 'service_role' );

create policy "Staff read audit_log" on audit_log for select using (
  current_user_role() in ('admin', 'developer') or auth.role() = 'service_role'
);
create policy "Service role inserts audit_log" on audit_log for insert
  with check ( auth.role() = 'service_role' );

create or replace function public.is_admin_or_developer()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from users
    where id = auth.uid()
    and role in ('admin', 'developer')
  );
$$;

drop policy if exists "Users can view their own details, admins and developers can view all" on users;
drop policy if exists "Users can read users" on users;

create policy "Users can view their own details, admins and developers can view all"
  on users for select
  using ( auth.uid() = id OR public.is_admin_or_developer() );

drop policy if exists "Users can insert self" on users;

create policy "Users can insert self as reporter only"
  on users for insert
  with check ( auth.uid() = id AND role = 'reporter' );

create policy "Admins can update user roles"
  on users for update
  using ( public.is_admin_or_developer() )
  with check ( public.is_admin_or_developer() );

-- 11. Initial fixed tags seed
insert into tags (name) values
  ('ui'),
  ('backend'),
  ('auth'),
  ('payment'),
  ('performance'),
  ('crash'),
  ('data-loss')
on conflict (name) do nothing;

-- 12. Rate Limits table
create table rate_limits (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  created_at timestamptz default now()
);
alter table rate_limits enable row level security;

create policy "Service role manages rate_limits" on rate_limits for all
  using ( auth.role() = 'service_role' )
  with check ( auth.role() = 'service_role' );
