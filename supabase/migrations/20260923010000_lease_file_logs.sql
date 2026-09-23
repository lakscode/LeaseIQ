-- Step-by-step processing log for each uploaded lease file, written by both
-- the browser pipeline and the analyze-lease Edge Function.

create table public.lease_file_logs (
  id bigint generated always as identity primary key,
  file_id uuid not null references public.lease_files (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  source text not null check (source in ('browser', 'function')),
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  step text not null,
  message text not null,
  data jsonb
);

create index lease_file_logs_file_id_idx on public.lease_file_logs (file_id, id);

alter table public.lease_file_logs enable row level security;

create policy "Users read their own lease file logs" on public.lease_file_logs
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users write logs for their own lease files" on public.lease_file_logs
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.lease_files f where f.id = file_id and f.user_id = (select auth.uid()))
  );

notify pgrst, 'reload schema';
