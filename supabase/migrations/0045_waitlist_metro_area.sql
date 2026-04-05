-- Replace company with metropolitan area for rough geo intent.

alter table public.waitlist_signups
  drop column if exists company_name;

alter table public.waitlist_signups
  add column if not exists metro_area text;

comment on column public.waitlist_signups.metro_area is 'User-reported metro / region (e.g. Melbourne, Australia).';
