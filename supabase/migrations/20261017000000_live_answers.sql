-- Answers heard mid-call through the agent's report_availability tool: provisional until the post-call extraction
-- replaces them. A search can stop dialling once a shop confirms it has everything and will hold it. Tool calls
-- are logged in call_events like webhooks. RLS and grants are unchanged.
alter table public.call_executions
  add column live_answer jsonb,
  add column live_answer_at timestamptz;
alter table public.search_requests add column stop_when_found boolean not null default true;
alter table public.call_events drop constraint call_events_source_check;
alter table public.call_events add constraint call_events_source_check
  check (source in ('webhook', 'poll', 'simulated', 'replay', 'dispatch', 'watchdog', 'tool'));
