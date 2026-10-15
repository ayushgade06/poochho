-- Poochho schema. Every table is server-only: RLS is enabled with no policies, so the publishable key
-- can read or write nothing. The server uses the secret key (service_role), which bypasses RLS.

create table public.shops (
  id text primary key,
  name text not null,
  phone text unique, -- E.164; null for demo/replay shops, which can never be called
  language text not null default 'hi',
  city text not null default '',
  area text not null,
  address text,
  source text not null check (source in ('demo', 'live', 'replay')),
  consent_status text not null default 'unverified' check (consent_status in ('verified', 'unverified', 'revoked')),
  consent_note text, -- how and when consent was obtained
  consent_verified_at timestamptz,
  opted_out_at timestamptz, -- set once; suppresses all future calls to this number
  opt_out_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_shops_have_phone check (source <> 'live' or phone is not null),
  constraint verified_consent_is_dated check (consent_status <> 'verified' or consent_verified_at is not null)
);

create table public.search_requests (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('simulated', 'live', 'replay')),
  product text not null check (length(product) between 1 and 120),
  brand_or_variant text,
  category text,
  quantity numeric not null check (quantity > 0 and quantity <= 1000),
  unit text not null,
  city text not null,
  area text not null,
  language text not null,
  max_budget_inr numeric check (max_budget_inr > 0),
  need_within_minutes integer check (need_within_minutes > 0),
  constraints text,
  replay_of text, -- replay id (data/replays.json) when mode = 'replay'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.call_executions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.search_requests (id) on delete cascade,
  shop_id text not null references public.shops (id),
  kind text not null default 'quote' check (kind in ('quote', 'hold')),
  mode text not null check (mode in ('simulated', 'live', 'replay')),
  status text not null default 'queued'
    check (status in ('queued', 'dispatching', 'ringing', 'talking', 'processing', 'done', 'failed', 'timeout')),
  provider_execution_id text unique,
  provider_status text,
  error text,
  transcript text,
  extracted jsonb, -- validated by lib/extraction.ts
  raw_extracted jsonb, -- exactly what the provider returned, for labelling and audits
  duration_seconds numeric,
  script jsonb, -- SIMULATED/REPLAY only: [{ at: ms, event }]
  script_cursor integer not null default 0,
  version integer not null default 0, -- optimistic concurrency for webhook/poll merges
  dispatched_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  first_quote_at timestamptz,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index call_executions_request_idx on public.call_executions (request_id);
create index call_executions_active_idx on public.call_executions (mode, status)
  where status in ('queued', 'dispatching', 'ringing', 'talking', 'processing');
-- One reservation call per shop per search.
create unique index call_executions_one_hold_idx on public.call_executions (request_id, shop_id) where kind = 'hold';

create table public.call_events (
  id bigint generated always as identity primary key,
  execution_id uuid not null references public.call_executions (id) on delete cascade,
  source text not null check (source in ('webhook', 'poll', 'simulated', 'replay', 'dispatch', 'watchdog')),
  provider_status text,
  payload jsonb, -- sanitised: no phone numbers or recording URLs
  received_at timestamptz not null default now()
);
create index call_events_execution_idx on public.call_events (execution_id, received_at);

create table public.result_labels (
  id bigint generated always as identity primary key,
  execution_id uuid not null references public.call_executions (id) on delete cascade,
  field text not null,
  is_correct boolean not null,
  correct_value text,
  created_at timestamptz not null default now(),
  unique (execution_id, field)
);

alter table public.shops enable row level security;
alter table public.search_requests enable row level security;
alter table public.call_executions enable row level security;
alter table public.call_events enable row level security;
alter table public.result_labels enable row level security;

revoke all on public.shops, public.search_requests, public.call_executions, public.call_events, public.result_labels
  from anon, authenticated;
grant all on public.shops, public.search_requests, public.call_executions, public.call_events, public.result_labels
  to service_role;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger shops_touch before update on public.shops for each row execute function public.touch_updated_at();
create trigger search_requests_touch before update on public.search_requests for each row execute function public.touch_updated_at();
create trigger call_executions_touch before update on public.call_executions for each row execute function public.touch_updated_at();

-- Realtime: ping the search's public broadcast channel on every call change. The payload carries no
-- personal data; clients refetch the state through the API. Failure here must never block a write.
create function public.notify_call_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('execution_id', new.id, 'status', new.status),
      'call_changed',
      'search:' || new.request_id::text,
      false
    );
  exception when others then
    null;
  end;
  return null;
end $$;
create trigger call_executions_notify after insert or update on public.call_executions
  for each row execute function public.notify_call_change();
