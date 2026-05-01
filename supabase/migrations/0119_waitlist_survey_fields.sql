-- Migration: 0119_waitlist_survey_fields
-- Add columns to waitlist_signups to persist the multi-step survey answers
-- collected by the new WaitlistModal flow.
--
-- Commuter path fields:
--   commute_pain_keys  — multi-select pain-point keys (e.g. ["parking","cost"])
--   commute_pain_other — free-text "Other" pain description
--   commute_cost       — monthly cost bracket key (e.g. "250to600")
--   commute_days       — office days per week key (e.g. "3")
--   commute_trust_keys — multi-select hesitation keys
--   commute_trust_other— free-text "Other" trust concern
--   commute_role       — contribution role key (e.g. "driver")
--   commute_role_other — free-text "Other" role description
--   work_location      — free-text workplace address / area
--
-- Organisation path fields:
--   org_challenge      — biggest challenge key (e.g. "parking")
--   org_size           — headcount bucket key (e.g. "50to250")
--   org_subsidy        — current subsidy status key (e.g. "yes")
--   company_name       — free-text company name
--   job_title          — free-text job title

alter table waitlist_signups
  add column if not exists commute_pain_keys  text[]  default null,
  add column if not exists commute_pain_other text    default null,
  add column if not exists commute_cost       text    default null,
  add column if not exists commute_days       text    default null,
  add column if not exists commute_trust_keys text[]  default null,
  add column if not exists commute_trust_other text   default null,
  add column if not exists commute_role       text    default null,
  add column if not exists commute_role_other text    default null,
  add column if not exists work_location      text    default null,
  add column if not exists org_challenge      text    default null,
  add column if not exists org_size           text    default null,
  add column if not exists org_subsidy        text    default null,
  add column if not exists company_name       text    default null,
  add column if not exists job_title          text    default null;

comment on column waitlist_signups.commute_pain_keys   is 'Commuter: selected pain-point option keys';
comment on column waitlist_signups.commute_pain_other  is 'Commuter: free-text other pain description';
comment on column waitlist_signups.commute_cost        is 'Commuter: monthly cost bracket key';
comment on column waitlist_signups.commute_days        is 'Commuter: office days/week key';
comment on column waitlist_signups.commute_trust_keys  is 'Commuter: selected hesitation option keys';
comment on column waitlist_signups.commute_trust_other is 'Commuter: free-text other trust concern';
comment on column waitlist_signups.commute_role        is 'Commuter: contribution role key';
comment on column waitlist_signups.commute_role_other  is 'Commuter: free-text other role description';
comment on column waitlist_signups.work_location       is 'Commuter: workplace address or area';
comment on column waitlist_signups.org_challenge       is 'Organisation: biggest challenge key';
comment on column waitlist_signups.org_size            is 'Organisation: headcount bucket key';
comment on column waitlist_signups.org_subsidy         is 'Organisation: current subsidy status key';
comment on column waitlist_signups.company_name        is 'Organisation: company name';
comment on column waitlist_signups.job_title           is 'Organisation: job title';
