-- 1. Opt-outs are recorded by the database, atomically with the call update that carries them, so a failed
--    follow-up write can never leave an opted-out number callable.
create function public.record_opt_out() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.extracted ->> 'opt_out' = 'yes' then
    update public.shops
      set opted_out_at = now(), opt_out_note = 'Asked not to be called again (call ' || new.id || ')'
      where id = new.shop_id and opted_out_at is null;
  end if;
  return null;
end $$;
create trigger call_executions_opt_out after insert or update of extracted on public.call_executions
  for each row execute function public.record_opt_out();

-- 2. Claiming: live calls left queued for more than 10 minutes expire (stale requests are never dialled),
--    and recently timed-out calls still count as in flight (the provider may still be connected).
create or replace function public.claim_live_calls(max_active integer)
returns setof public.call_executions
language plpgsql security definer set search_path = '' as $$
declare
  free integer;
begin
  perform pg_advisory_xact_lock(hashtext('poochho_live_dispatch'));
  update public.call_executions
    set status = 'failed', error = 'not placed: expired after 10 minutes in the queue', ended_at = now(), version = version + 1
    where mode = 'live' and status = 'queued' and created_at < now() - interval '10 minutes';
  select max_active - count(*) into free
    from public.call_executions
    where mode = 'live'
      and (status in ('dispatching', 'ringing', 'talking')
        or (status = 'timeout' and dispatched_at > now() - interval '15 minutes'));
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
