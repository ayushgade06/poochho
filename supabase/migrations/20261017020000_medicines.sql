-- Medicine mode (M2). Single-salt medicines that aren't discontinued, from the A-Z Medicine Dataset of India
-- (Kaggle, CC BY-SA 4.0, as of Nov 2022), loaded by `npm run seed:medicines`. The data itself is never committed.
-- Closed to the browser: GET /api/medicines searches it on the server.
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions; -- wherever pg_trgm lives, its operator class resolves below

create table public.medicines (
  id integer primary key,   -- the dataset's id
  name text not null,       -- "Dolo 650 Tablet"
  composition text not null, -- the one salt: "Paracetamol"
  strength text,            -- "650 mg"; null when the dataset says NA
  form text                 -- "tablet", "SR tablet", "eye/ear drops"…; null when the name doesn't say
);
create index medicines_name_trgm on public.medicines using gin (name gin_trgm_ops);
alter table public.medicines enable row level security;
revoke all on public.medicines from anon, authenticated;
grant all on public.medicines to service_role;

-- Up to 10 medicines whose name contains the query, or closely matches it as a word ("Dolo 650"), best first.
create function public.search_medicines(q text)
returns setof public.medicines
language sql stable set search_path = public, extensions as $$
  select m.* from public.medicines m
  where m.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' or q <% m.name
  order by word_similarity(q, m.name) desc, length(m.name), m.id
  limit 10
$$;
revoke all on function public.search_medicines(text) from public, anon, authenticated;
grant execute on function public.search_medicines(text) to service_role;

-- What the user confirmed for a pharmacy search: the composition ("Paracetamol 650 mg tablet") and whether the
-- shops may be asked for it under another brand (only if lib/medicine.ts allows it for this medicine).
alter table public.search_requests
  add column composition text,
  add column ask_alternative boolean not null default false,
  add constraint search_requests_alternative_check check (not ask_alternative or composition is not null);
