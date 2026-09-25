-- Retrieval for the lease chat (lease-chat Edge Function): full-text search
-- over every page of the user's lease files, mapped to the lease document
-- (main lease, amendment, ...) that covers the page.

create index if not exists lease_file_pages_fts_idx
  on public.lease_file_pages using gin (to_tsvector('english', text));

-- Terms are OR-ed together and ranked by cover density, so long natural
-- language queries still match pages that contain only some of the words.
-- Runs as the caller: row level security limits results to their own leases.
create or replace function public.search_lease_pages(
  search_query text,
  lease_filter uuid default null,
  match_count integer default 8
)
returns table (
  lease_id uuid,
  lease_title text,
  doc_type text,
  page_number integer,
  rank real,
  excerpt text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select to_tsquery('english', replace(plainto_tsquery('english', search_query)::text, ' & ', ' | ')) as tsq
    where plainto_tsquery('english', search_query)::text <> ''
  )
  select
    l.id,
    l.title,
    l.doc_type,
    p.page_number,
    ts_rank_cd(to_tsvector('english', p.text), q.tsq) as rank,
    ts_headline('english', p.text, q.tsq,
      'MaxFragments=3, MaxWords=60, MinWords=25, FragmentDelimiter=" … "') as excerpt
  from q
  join public.lease_file_pages p on to_tsvector('english', p.text) @@ q.tsq
  join public.leases l on l.file_id = p.file_id and p.page_number between l.page_start and l.page_end
  where lease_filter is null or l.id = lease_filter
  order by rank desc
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.search_lease_pages(text, uuid, integer) from public, anon;
grant execute on function public.search_lease_pages(text, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
