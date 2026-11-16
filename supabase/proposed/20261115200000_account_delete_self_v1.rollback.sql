-- SUPERSEDED by 20261116090000_account_delete_self_v2 (2026-11-16): v1's preflight refused the live database (unlisted account columns in archive, discordos and platform tables). Kept for the record only; never apply.
-- ROLLBACK for 20261115200000_account_delete_self_v1.sql. PROPOSED, OWNER-GATED. NOT APPLIED.
-- Removes the delete-account API, its inner function and the attempts table. Takes USAGE on
-- account_api back from authenticated ONLY when no other account_api function (change username v1)
-- still needs it.
--
-- This does NOT bring back any deleted account or row: deleted data has no recovery except a provider
-- backup/PITR restore, if the project has one.
--
-- account_private.account_deletions (the audit rows: hashed id, time, row counts) is KEPT on purpose,
-- so the record of deletions that already happened survives a rollback. A re-apply reuses it.
-- The portal keeps working after this rollback: Delete account shows "Deleting is unavailable right
-- now." (PGRST202/42501 are mapped to that line).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

drop function if exists account_api.account_delete_self(text);
drop function if exists account_private.delete_account_v1(uuid, jsonb, text);
drop table if exists account_private.account_delete_attempts;

do $usage$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'account_api' and has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    revoke usage on schema account_api from authenticated;
  end if;
end;
$usage$;

do $postcheck$
begin
  if to_regprocedure('account_api.account_delete_self(text)') is not null
     or to_regprocedure('account_private.delete_account_v1(uuid, jsonb, text)') is not null
     or to_regclass('account_private.account_delete_attempts') is not null then
    raise exception 'DELETE_ACCOUNT_ROLLBACK_RESIDUE';
  end if;
  if has_schema_privilege('authenticated', 'account_api', 'usage') and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'account_api' and has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    raise exception 'DELETE_ACCOUNT_ROLLBACK_AUTHENTICATED_STILL_HAS_USAGE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
