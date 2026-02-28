create extension if not exists pgcrypto;

create table if not exists searches (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  gemi_number text,
  company_name text,
  status text default 'pending',
  current_stage text,
  error text,
  report_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  search_id uuid references searches(id) on delete set null,
  gemi_number text,
  company_name text,
  report jsonb not null,
  risk_score int,
  flags text[],
  share_token uuid default gen_random_uuid(),
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '7 days'
);

create table if not exists advisor_cache (
  cache_key text primary key,
  company_slug text not null,
  verdict text not null,
  memo text not null,
  generated_by text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

create table if not exists advisor_feedback (
  id uuid primary key default gen_random_uuid(),
  company_slug text not null,
  verdict text not null,
  rating text not null check (rating in ('up', 'down')),
  created_at timestamptz default now()
);

create index if not exists idx_reports_gemi_number on reports(gemi_number);
create index if not exists idx_reports_share_token on reports(share_token);
create index if not exists idx_searches_status on searches(status);
create index if not exists idx_advisor_cache_company_slug on advisor_cache(company_slug);
create index if not exists idx_advisor_cache_expires_at on advisor_cache(expires_at);
create index if not exists idx_advisor_feedback_company_slug on advisor_feedback(company_slug);
create index if not exists idx_advisor_feedback_created_at on advisor_feedback(created_at desc);

-- Row Level Security: lock tables to service-role only access.
alter table searches enable row level security;
alter table reports enable row level security;
alter table advisor_cache enable row level security;
alter table advisor_feedback enable row level security;

alter table searches force row level security;
alter table reports force row level security;
alter table advisor_cache force row level security;
alter table advisor_feedback force row level security;

revoke all on table searches from anon, authenticated;
revoke all on table reports from anon, authenticated;
revoke all on table advisor_cache from anon, authenticated;
revoke all on table advisor_feedback from anon, authenticated;

drop policy if exists "service_role_full_access_searches" on searches;
create policy "service_role_full_access_searches"
on searches
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_full_access_reports" on reports;
create policy "service_role_full_access_reports"
on reports
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_full_access_advisor_cache" on advisor_cache;
create policy "service_role_full_access_advisor_cache"
on advisor_cache
as permissive
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_full_access_advisor_feedback" on advisor_feedback;
create policy "service_role_full_access_advisor_feedback"
on advisor_feedback
as permissive
for all
to service_role
using (true)
with check (true);
