-- Atomically claim queued LIVE calls without exceeding the concurrency limit. An advisory lock serialises
-- concurrent dispatchers (several tabs, holds, webhooks), so the in-flight count cannot be read stale.
create function public.claim_live_calls(max_active integer)
returns setof public.call_executions
language plpgsql security definer set search_path = '' as $$
declare
  free integer;
begin
  perform pg_advisory_xact_lock(hashtext('poochho_live_dispatch'));
  select max_active - count(*) into free
    from public.call_executions
    where mode = 'live' and status in ('dispatching', 'ringing', 'talking');
  if free <= 0 then
    return;
  end if;
  return query
    update public.call_executions c
      set status = 'dispatching', dispatched_at = now(), version = c.version + 1
      where c.id in (
        select id from public.call_executions
        where mode = 'live' and status = 'queued'
        order by created_at, id
        limit free
      )
      returning c.*;
end $$;

revoke all on function public.claim_live_calls(integer) from public, anon, authenticated;
grant execute on function public.claim_live_calls(integer) to service_role;
