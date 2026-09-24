-- Clauses of each lease document, labelled by the SVM clause classifier in
-- the analyze-lease Edge Function (model trained by ml/clause_svm.py).

create table public.lease_clauses (
  id bigint generated always as identity primary key,
  lease_id uuid not null references public.leases (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  clause_index integer not null,
  page_number integer not null,
  text text not null,
  label_id text not null,
  label text not null,
  score real not null,
  -- Runner-up labels: [{ labelId, label, score }]
  alternatives jsonb not null default '[]'::jsonb,
  unique (lease_id, clause_index)
);

create index lease_clauses_user_id_idx on public.lease_clauses (user_id);

alter table public.lease_clauses enable row level security;

create policy "Users manage their own lease clauses" on public.lease_clauses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
