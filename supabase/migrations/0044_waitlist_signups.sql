-- Public marketing waitlist: anonymous inserts only; no public reads.

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  company_name text,
  intent text,
  source text,
  created_at timestamptz not null default now(),
  constraint waitlist_signups_email_nonempty check (length(trim(email)) > 0)
);

comment on table public.waitlist_signups is 'Marketing waitlist signups from the public landing page.';

create unique index if not exists waitlist_signups_email_lower_key
  on public.waitlist_signups (lower(trim(email)));

alter table public.waitlist_signups enable row level security;

-- Inserts from anon (and authenticated) only; selects reserved for service role / future admin tooling.
create policy "waitlist_signups_insert_public"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (true);
