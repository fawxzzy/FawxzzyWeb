create schema if not exists fawxzzy_analytics;

revoke all on schema fawxzzy_analytics from public, anon, authenticated;
grant usage on schema fawxzzy_analytics to service_role;

create table if not exists fawxzzy_analytics.events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default statement_timestamp(),
  event_name text not null check (
    event_name in ('page_view', 'tiktok_open', 'catalog_app_view', 'app_launch', 'compatibility_visit')
  ),
  product text not null check (product in ('web', 'fitness', 'mazer')),
  route text not null check (
    route in ('/', '/apps', '/apps/fitness', '/apps/mazer', 'app')
  ),
  app text check (app is null or app in ('fitness', 'mazer')),
  compatibility_source text check (
    compatibility_source is null or compatibility_source in (
      'discover', 'trove', 'fitness_legacy_origin', 'mazer_legacy_origin'
    )
  ),
  check (
    (
      product = 'web' and route <> 'app' and event_name <> 'compatibility_visit' and
      (compatibility_source is null or compatibility_source in ('discover', 'trove'))
    ) or (
      product = 'fitness' and route = 'app' and event_name = 'compatibility_visit' and
      app is null and compatibility_source = 'fitness_legacy_origin'
    ) or (
      product = 'mazer' and route = 'app' and event_name = 'compatibility_visit' and
      app is null and compatibility_source = 'mazer_legacy_origin'
    )
  )
);

alter table fawxzzy_analytics.events enable row level security;
revoke all on table fawxzzy_analytics.events from public, anon, authenticated;
grant insert, select on table fawxzzy_analytics.events to service_role;
grant usage, select on sequence fawxzzy_analytics.events_id_seq to service_role;

create index if not exists events_occurred_at_idx
  on fawxzzy_analytics.events (occurred_at desc);
create index if not exists events_compatibility_observation_idx
  on fawxzzy_analytics.events (compatibility_source, occurred_at desc)
  where compatibility_source is not null;

comment on table fawxzzy_analytics.events is
  'Privacy-minimal first-party website analytics. No cookies, user IDs, IP addresses, user agents, free-form URLs, or referrers.';
