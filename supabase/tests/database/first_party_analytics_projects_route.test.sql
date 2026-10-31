-- Source-only pgTAP coverage for a disposable local Supabase database fixture.
-- Never point this test at an existing development or production database: it inserts
-- synthetic analytics rows inside a transaction and rolls them back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select has_table(
  'fawxzzy_analytics',
  'events',
  'First-party analytics table remains present'
);

select ok(
  (select c.relrowsecurity
     from pg_class as c
     join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'fawxzzy_analytics'
      and c.relname = 'events'),
  'RLS remains enabled on analytics events'
);

select ok(
  (select c.convalidated
     from pg_constraint as c
    where c.conrelid = 'fawxzzy_analytics.events'::regclass
      and c.conname = 'events_route_check'
      and c.contype = 'c'),
  'The route constraint remains validated'
);

select hasnt_column('fawxzzy_analytics', 'events', 'user_id', 'Analytics does not store user IDs');
select hasnt_column('fawxzzy_analytics', 'events', 'ip_address', 'Analytics does not store IP addresses');
select hasnt_column('fawxzzy_analytics', 'events', 'user_agent', 'Analytics does not store user agents');
select hasnt_column('fawxzzy_analytics', 'events', 'raw_url', 'Analytics does not store free-form URLs');
select hasnt_column('fawxzzy_analytics', 'events', 'referrer', 'Analytics does not store referrers');

select ok(not has_schema_privilege('anon', 'fawxzzy_analytics', 'USAGE'), 'anon has no analytics schema access');
select ok(not has_schema_privilege('authenticated', 'fawxzzy_analytics', 'USAGE'), 'authenticated has no analytics schema access');
select ok(has_schema_privilege('service_role', 'fawxzzy_analytics', 'USAGE'), 'service_role retains analytics schema usage');
select ok(not has_table_privilege('anon', 'fawxzzy_analytics.events', 'SELECT'), 'anon cannot select analytics events');
select ok(not has_table_privilege('anon', 'fawxzzy_analytics.events', 'INSERT'), 'anon cannot insert analytics events');
select ok(not has_table_privilege('authenticated', 'fawxzzy_analytics.events', 'SELECT'), 'authenticated cannot select analytics events');
select ok(not has_table_privilege('authenticated', 'fawxzzy_analytics.events', 'INSERT'), 'authenticated cannot insert analytics events');
select ok(has_table_privilege('service_role', 'fawxzzy_analytics.events', 'SELECT'), 'service_role retains analytics select');
select ok(has_table_privilege('service_role', 'fawxzzy_analytics.events', 'INSERT'), 'service_role retains analytics insert');
select ok(has_sequence_privilege('service_role', 'fawxzzy_analytics.events_id_seq', 'USAGE'), 'service_role retains analytics sequence usage');
select ok(has_sequence_privilege('service_role', 'fawxzzy_analytics.events_id_seq', 'SELECT'), 'service_role retains analytics sequence select');

select lives_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'web', '/projects')$$,
  'The canonical /projects page view is accepted'
);

select lives_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values
      ('page_view', 'web', '/'),
      ('page_view', 'web', '/apps'),
      ('page_view', 'web', '/apps/fitness'),
      ('page_view', 'web', '/apps/mazer')$$,
  'Existing canonical web routes remain accepted'
);

select lives_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route, compatibility_source)
    values ('compatibility_visit', 'fitness', 'app', 'fitness_legacy_origin')$$,
  'The existing Fitness compatibility route remains accepted'
);

select lives_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route, compatibility_source)
    values ('compatibility_visit', 'mazer', 'app', 'mazer_legacy_origin')$$,
  'The existing Mazer compatibility route remains accepted'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'web', '/account')$$,
  '23514', NULL,
  'An account route is rejected'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'web', '/private/arbitrary')$$,
  '23514', NULL,
  'An arbitrary private route is rejected'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'web', '/Projects')$$,
  '23514', NULL,
  'A differently cased route is rejected'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'web', '/a pps')$$,
  '23514', NULL,
  'A route with altered whitespace is rejected'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'fitness', 'app')$$,
  '23514', NULL,
  'An incompatible Fitness product and event combination is rejected'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'fitness', '/projects')$$,
  '23514', NULL,
  'Fitness page views cannot use the Web projects route'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('page_view', 'mazer', '/projects')$$,
  '23514', NULL,
  'Mazer page views cannot use the Web projects route'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('compatibility_visit', 'web', '/projects')$$,
  '23514', NULL,
  'A compatibility event cannot be recorded as a Web page view'
);

select throws_ok(
  $$insert into fawxzzy_analytics.events (event_name, product, route)
    values ('private_event', 'web', '/projects')$$,
  '23514', NULL,
  'An event outside the existing closed vocabulary is rejected'
);

select * from finish();
rollback;
