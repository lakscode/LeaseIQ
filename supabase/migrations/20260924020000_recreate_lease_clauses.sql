-- Recreate lease_clauses: the table from 20260924010000 was dropped on the
-- hosted project while that migration stayed recorded as applied. Safe to run
-- whether or not the table exists.

create table if not exists public.lease_clauses (
  id bigint generated always as identity primary key,
  lease_id uuid not null references public.leases (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  clause_index integer not null,
  page_number integer not null,
  text text not null,
  label_id text not null,
  -- Display name from ml/clause_labels.csv at the time the clause was classified.
  label text not null,
  score real not null,
  -- Runner-up labels: [{ labelId, label, score }]
  alternatives jsonb not null default '[]'::jsonb,
  unique (lease_id, clause_index)
);

create index if not exists lease_clauses_user_id_idx on public.lease_clauses (user_id);

alter table public.lease_clauses enable row level security;

drop policy if exists "Users manage their own lease clauses" on public.lease_clauses;
create policy "Users manage their own lease clauses" on public.lease_clauses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
