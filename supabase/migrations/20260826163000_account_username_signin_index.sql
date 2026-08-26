create schema if not exists account_private;

create table if not exists account_private.username_signin_index (
  user_id uuid primary key references auth.users(id) on delete cascade,
  normalized_username text not null unique,
  updated_at timestamptz not null default now(),
  constraint username_signin_index_syntax
    check (normalized_username ~ '^[a-z0-9._-]{2,15}$')
);

revoke all on table account_private.username_signin_index from public, anon, authenticated;
grant select, insert, update, delete on table account_private.username_signin_index to service_role;

create or replace function account_private.refresh_username_signin_candidate(candidate text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
begin
  delete from account_private.username_signin_index
  where normalized_username = candidate;

  insert into account_private.username_signin_index (user_id, normalized_username, updated_at)
  select candidate_user.id, candidate, now()
  from auth.users candidate_user
  where lower(trim(coalesce(candidate_user.raw_user_meta_data ->> 'username', ''))) = candidate
    and not exists (
      select 1
      from auth.users conflicting_user
      where conflicting_user.id <> candidate_user.id
        and lower(trim(coalesce(conflicting_user.raw_user_meta_data ->> 'username', ''))) = candidate
    );
end;
$$;

revoke execute on function account_private.refresh_username_signin_candidate(text)
  from public, anon, authenticated;

create or replace function account_private.sync_username_signin_index()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
declare
  old_candidate text;
  new_candidate text;
begin
  if tg_op <> 'INSERT' then
    old_candidate := lower(trim(coalesce(old.raw_user_meta_data ->> 'username', '')));
  end if;
  if tg_op <> 'DELETE' then
    new_candidate := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  end if;

  if old_candidate ~ '^[a-z0-9._-]{2,15}$' then
    perform account_private.refresh_username_signin_candidate(old_candidate);
  end if;
  if new_candidate ~ '^[a-z0-9._-]{2,15}$'
     and new_candidate is distinct from old_candidate then
    perform account_private.refresh_username_signin_candidate(new_candidate);
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function account_private.sync_username_signin_index() from public, anon, authenticated;

insert into account_private.username_signin_index (user_id, normalized_username)
select user_id, normalized_username
from (
  select id as user_id,
         lower(trim(raw_user_meta_data ->> 'username')) as normalized_username,
         count(*) over (
           partition by lower(trim(raw_user_meta_data ->> 'username'))
         ) as claim_count
  from auth.users
  where lower(trim(coalesce(raw_user_meta_data ->> 'username', ''))) ~ '^[a-z0-9._-]{2,15}$'
) candidates
where claim_count = 1
on conflict (user_id) do update
  set normalized_username = excluded.normalized_username,
      updated_at = now();

drop trigger if exists sync_username_signin_index on auth.users;
create trigger sync_username_signin_index
after insert or update or delete on auth.users
for each row execute function account_private.sync_username_signin_index();

create table if not exists account_private.username_signin_attempts (
  attempt_key text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  constraint username_signin_attempt_key_sha256 check (attempt_key ~ '^[0-9a-f]{64}$'),
  constraint username_signin_attempt_count_positive check (attempt_count > 0)
);

revoke all on table account_private.username_signin_attempts from public, anon, authenticated;
grant select, insert, update, delete on table account_private.username_signin_attempts to service_role;

create or replace function public.account_resolve_username_signin(
  p_normalized_username text,
  p_attempt_key text,
  p_client_attempt_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, account_private
as $$
declare
  now_value timestamptz := clock_timestamp();
  current_count integer;
  client_count integer;
  global_count integer;
  resolved_user_id uuid;
begin
  if p_normalized_username !~ '^[a-z0-9._-]{2,15}$'
     or p_attempt_key !~ '^[0-9a-f]{64}$'
     or p_client_attempt_key !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  delete from account_private.username_signin_attempts
  where window_started_at <= now_value - interval '15 minutes';

  insert into account_private.username_signin_attempts (
    attempt_key,
    window_started_at,
    attempt_count
  ) values (repeat('0', 64), now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into global_count;

  if global_count > 500 then
    return null;
  end if;

  insert into account_private.username_signin_attempts (
    attempt_key,
    window_started_at,
    attempt_count
  ) values (p_client_attempt_key, now_value, 1)
  on conflict (attempt_key) do update
    set attempt_count = account_private.username_signin_attempts.attempt_count + 1
  returning attempt_count into client_count;

  if client_count > 30 then
    return null;
  end if;

  insert into account_private.username_signin_attempts (
    attempt_key,
    window_started_at,
    attempt_count
  ) values (p_attempt_key, now_value, 1)
  on conflict (attempt_key) do update
    set window_started_at = case
          when account_private.username_signin_attempts.window_started_at <= now_value - interval '15 minutes'
            then now_value
          else account_private.username_signin_attempts.window_started_at
        end,
        attempt_count = case
          when account_private.username_signin_attempts.window_started_at <= now_value - interval '15 minutes'
            then 1
          else account_private.username_signin_attempts.attempt_count + 1
        end
  returning attempt_count into current_count;

  if current_count > 10 then
    return null;
  end if;

  select user_id into resolved_user_id
  from account_private.username_signin_index
  where normalized_username = p_normalized_username;
  return resolved_user_id;
end;
$$;

revoke execute on function public.account_resolve_username_signin(text, text, text)
  from public, anon, authenticated;
grant execute on function public.account_resolve_username_signin(text, text, text)
  to service_role;
