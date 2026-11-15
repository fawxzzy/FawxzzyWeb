-- ROLLBACK for 20261115190000_account_change_username_v1.sql. PROPOSED, OWNER-GATED. NOT APPLIED.
-- Removes the change-username API, its inner function and the attempts table, and takes USAGE on
-- account_api back from authenticated. Usernames already changed stay changed (they are ordinary
-- auth.users metadata, judged by the live guard).
-- The portal keeps working after this rollback: Change username shows "Changes are unavailable right
-- now." (PGRST202/42501 are mapped to that line).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

revoke usage on schema account_api from authenticated;
drop function if exists account_api.account_change_username(text);
drop function if exists account_private.change_username_v1(uuid, text);
drop table if exists account_private.username_change_attempts;

do $postcheck$
begin
  if to_regprocedure('account_api.account_change_username(text)') is not null
     or to_regprocedure('account_private.change_username_v1(uuid, text)') is not null
     or to_regclass('account_private.username_change_attempts') is not null then
    raise exception 'CHANGE_USERNAME_ROLLBACK_RESIDUE';
  end if;
  if has_schema_privilege('authenticated', 'account_api', 'usage') then
    raise exception 'CHANGE_USERNAME_ROLLBACK_AUTHENTICATED_STILL_HAS_USAGE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
