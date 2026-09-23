-- Lease Abstraction module: uploaded files, their page text, and the lease
-- documents (main leases + child amendments/addenda) found inside them.

-- One row per uploaded PDF.
create table public.lease_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  page_count integer not null default 0,
  is_scanned boolean not null default false,
  ocr_pages integer not null default 0,
  -- processing -> analyzing (AI running) -> analyzed (AI done, PDF being split) -> completed | failed
  status text not null default 'processing'
    check (status in ('processing', 'analyzing', 'analyzed', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index lease_files_user_id_idx on public.lease_files (user_id, created_at desc);

-- Extracted (digital or OCR'd) text for every page of an uploaded file.
create table public.lease_file_pages (
  file_id uuid not null references public.lease_files (id) on delete cascade,
  page_number integer not null,
  text text not null default '',
  is_ocr boolean not null default false,
  primary key (file_id, page_number)
);

-- One row per document found in a file. Amendments, addenda etc. point at
-- their main lease through parent_id (which may live in a different file).
create table public.leases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_id uuid not null references public.lease_files (id) on delete cascade,
  parent_id uuid references public.leases (id) on delete set null,
  doc_type text not null
    check (doc_type in ('main_lease', 'amendment', 'addendum', 'extension', 'assignment', 'sublease', 'guaranty', 'other')),
  title text not null,
  page_start integer not null,
  page_end integer not null,
  storage_path text,
  effective_date date,
  landlord text,
  tenant text,
  premises text,
  summary text,
  abstract jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (page_end >= page_start),
  check (parent_id is null or doc_type <> 'main_lease')
);

create index leases_user_id_idx on public.leases (user_id);
create index leases_file_id_idx on public.leases (file_id);
create index leases_parent_id_idx on public.leases (parent_id);

-- Row level security: users only ever see their own data.
alter table public.lease_files enable row level security;
alter table public.lease_file_pages enable row level security;
alter table public.leases enable row level security;

create policy "Users manage their own lease files" on public.lease_files
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage pages of their own lease files" on public.lease_file_pages
  for all to authenticated
  using (exists (select 1 from public.lease_files f where f.id = file_id and f.user_id = (select auth.uid())))
  with check (exists (select 1 from public.lease_files f where f.id = file_id and f.user_id = (select auth.uid())));

create policy "Users manage their own leases" on public.leases
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Private storage bucket. Objects live under "<user id>/<file id>/...".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lease-files', 'lease-files', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "Users read their own lease PDFs" on storage.objects
  for select to authenticated
  using (bucket_id = 'lease-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload their own lease PDFs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lease-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users update their own lease PDFs" on storage.objects
  for update to authenticated
  using (bucket_id = 'lease-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own lease PDFs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lease-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Make the new tables visible to the API immediately.
notify pgrst, 'reload schema';
