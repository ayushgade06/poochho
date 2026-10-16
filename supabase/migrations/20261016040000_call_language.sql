-- Each call records the language it was placed in (a shop is called in its own language when the agent speaks it),
-- and a search records the language the user spoke it in, so results can show "asked in X → called in Y". Both
-- are null on older rows. RLS and grants are unchanged.
alter table public.call_executions add column language text;
alter table public.search_requests add column asked_in text;
