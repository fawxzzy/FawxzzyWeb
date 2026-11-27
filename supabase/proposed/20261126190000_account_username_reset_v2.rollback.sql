-- ROLLBACK for 20261126190000_account_username_reset_v2.sql. PROPOSED, OWNER-GATED. NOT APPLIED.
-- Removes the v2 resolver and the v2 send-window release (API wrappers and inner functions). v1 and everything else stay untouched; the
-- send-window rows are hashed rows in account_private.username_signin_attempts that every resolver
-- call deletes once they are 15 minutes old.
-- ORDER: redeploy the previous Edge Function (the one that calls account_resolve_username_reset_v1)
-- FIRST, then run this file. Run in the other order, the deployed v2 function answers 503
-- reset_unavailable ("Could not send the email...") for every username until it is redeployed.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

drop function if exists account_api.account_resolve_username_reset_v2(text, text, text);
drop function if exists account_private.resolve_username_reset_v2(text, text, text);
drop function if exists account_api.account_release_username_reset_v2(text, timestamptz);
drop function if exists account_private.release_username_reset_v2(text, timestamptz);

do $postcheck$
begin
  if to_regprocedure('account_api.account_resolve_username_reset_v2(text, text, text)') is not null
     or to_regprocedure('account_private.resolve_username_reset_v2(text, text, text)') is not null
     or to_regprocedure('account_api.account_release_username_reset_v2(text, timestamptz)') is not null
     or to_regprocedure('account_private.release_username_reset_v2(text, timestamptz)') is not null then
    raise exception 'USERNAME_RESET_V2_ROLLBACK_RESIDUE';
  end if;
  if to_regprocedure('account_api.account_resolve_username_reset_v1(text, text, text)') is null then
    raise exception 'USERNAME_RESET_V2_ROLLBACK_V1_MISSING';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
