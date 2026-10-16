-- Judge mode: a search where the judge plays one shop in their own browser (Bolna Web Call SDK); the other shops
-- are simulated. A new mode for searches and calls, and a source for the one "Your shop" row.
alter table public.search_requests drop constraint search_requests_mode_check;
alter table public.search_requests add constraint search_requests_mode_check check (mode in ('simulated', 'live', 'replay', 'judge'));
alter table public.call_executions drop constraint call_executions_mode_check;
alter table public.call_executions add constraint call_executions_mode_check check (mode in ('simulated', 'live', 'replay', 'judge'));
alter table public.shops drop constraint shops_source_check;
alter table public.shops add constraint shops_source_check check (source in ('demo', 'live', 'replay', 'judge'));

-- Daily caps for public features that cost money (judge calls, Sarvam voice input), per hashed IP and overall,
-- counted atomically: bump_usage adds one and returns true only while the day's count is under the limit.
create table public.usage_counters (
  key text not null,
  day date not null,
  count integer not null default 0,
  primary key (key, day)
);
alter table public.usage_counters enable row level security;
revoke all on public.usage_counters from anon, authenticated;
grant all on public.usage_counters to service_role;

create function public.bump_usage(p_key text, p_limit integer)
returns boolean
language sql security definer set search_path = '' as $$
  insert into public.usage_counters as u (key, day, count)
  values (p_key, (now() at time zone 'Asia/Kolkata')::date, 1)
  on conflict (key, day) do update set count = u.count + 1 where u.count < p_limit
  returning true
$$;
revoke all on function public.bump_usage(text, integer) from public, anon, authenticated;
grant execute on function public.bump_usage(text, integer) to service_role;
