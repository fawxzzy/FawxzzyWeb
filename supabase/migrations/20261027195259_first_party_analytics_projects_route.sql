-- Append the canonical public /projects route to the closed analytics route vocabulary.
-- This migration is intentionally fail-closed: future application must see the exact
-- historical route constraint before it is replaced. No table, data, grants, or RLS
-- policy is recreated or changed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  v_relation oid;
  v_definition text;
  v_constraint_count integer;
  v_constraint_validated boolean;
  v_expected_definition text := $expected$CHECK ((route = ANY (ARRAY['/'::text, '/apps'::text, '/apps/fitness'::text, '/apps/mazer'::text, 'app'::text])))$expected$;
  v_expected_with_array_cast text := $expected$CHECK ((route = ANY ((ARRAY['/'::text, '/apps'::text, '/apps/fitness'::text, '/apps/mazer'::text, 'app'::text])::text[])))$expected$;
  v_expected_array_cast text := $expected$CHECK ((route = ANY (ARRAY['/'::text, '/apps'::text, '/apps/fitness'::text, '/apps/mazer'::text, 'app'::text]::text[])))$expected$;
begin
  v_relation := to_regclass('fawxzzy_analytics.events');

  if v_relation is null then
    raise exception using
      errcode = '55000',
      message = 'Hold analytics route migration: expected fawxzzy_analytics.events is absent.';
  end if;

  lock table fawxzzy_analytics.events in access exclusive mode;

  if to_regclass('fawxzzy_analytics.events') is distinct from v_relation then
    raise exception using
      errcode = '55000',
      message = 'Hold analytics route migration: analytics events relation changed during preflight.';
  end if;

  select count(*), min(pg_get_constraintdef(c.oid)), bool_and(c.convalidated)
    into v_constraint_count, v_definition, v_constraint_validated
    from pg_constraint as c
   where c.conrelid = v_relation
     and c.conname = 'events_route_check'
     and c.contype = 'c';

  if v_constraint_count <> 1 then
    raise exception using
      errcode = '55000',
      message = format(
        'Hold analytics route migration: expected exactly one events_route_check; found %s.',
        v_constraint_count
      );
  end if;

  if v_constraint_validated is not true then
    raise exception using
      errcode = '55000',
      message = 'Hold analytics route migration: events_route_check is not validated.';
  end if;

  if v_definition not in (
    v_expected_definition,
    v_expected_with_array_cast,
    v_expected_array_cast
  ) then
    raise exception using
      errcode = '55000',
      message = format(
        'Hold analytics route migration: unexpected events_route_check definition: %s',
        v_definition
      );
  end if;
end;
$migration$;

alter table fawxzzy_analytics.events
  drop constraint events_route_check;

alter table fawxzzy_analytics.events
  add constraint events_route_check
  check (route in ('/', '/apps', '/apps/fitness', '/apps/mazer', '/projects', 'app'));

commit;
