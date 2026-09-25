-- recreate_lease_clauses(): drops lease_clauses (if it exists) and creates it
-- again with its index and RLS policy. Called from the app's Settings page.
-- Runs as the function owner so authenticated users can execute the DDL.
-- This deletes every user's clauses; re-analyze files to repopulate them.

create or replace function public.recreate_lease_clauses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  drop table if exists public.lease_clauses;

  create table public.lease_clauses (
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

  create index lease_clauses_user_id_idx on public.lease_clauses (user_id);

  alter table public.lease_clauses enable row level security;

  create policy "Users manage their own lease clauses" on public.lease_clauses
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

  grant all on public.lease_clauses to authenticated, service_role;

  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke execute on function public.recreate_lease_clauses() from public, anon;
grant execute on function public.recreate_lease_clauses() to authenticated;

notify pgrst, 'reload schema';
