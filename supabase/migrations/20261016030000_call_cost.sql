-- What Bolna charged for each call, in US cents, from the execution's total_cost (it matched the wallet
-- deduction on the first real calls). Null for simulated calls. RLS and grants are unchanged: the table stays
-- closed to the publishable key.
alter table public.call_executions add column cost_cents numeric check (cost_cents >= 0);
