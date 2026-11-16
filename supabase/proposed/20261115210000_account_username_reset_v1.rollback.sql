-- ROLLBACK for 20261115210000_account_username_reset_v1.sql. PROPOSED, OWNER-GATED. NOT APPLIED.
-- Removes the username reset resolver (API wrapper and inner function). Nothing else is touched:
-- the reset counters are hashed rows in account_private.username_signin_attempts that the sign-in
-- functions delete once they are 15 minutes old.
-- After this rollback the Edge Function username-password-reset answers 503 reset_unavailable and the
-- portal shows "Could not send the email. Try again in a few minutes." (the same for every username).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

drop function if exists account_api.account_resolve_username_reset_v1(text, text, text);
drop function if exists account_private.resolve_username_reset_v1(text, text, text);

do $postcheck$
begin
  if to_regprocedure('account_api.account_resolve_username_reset_v1(text, text, text)') is not null
     or to_regprocedure('account_private.resolve_username_reset_v1(text, text, text)') is not null then
    raise exception 'USERNAME_RESET_ROLLBACK_RESIDUE';
  end if;
end;
$postcheck$;

notify pgrst, 'reload schema';

commit;
