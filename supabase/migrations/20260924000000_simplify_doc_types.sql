-- Reduce document types to main lease, amendment, addendum, commencement
-- letter and other. Extensions are amendments; the rest become other.

alter table public.leases drop constraint leases_doc_type_check;

update public.leases set doc_type = 'amendment' where doc_type = 'extension';
update public.leases set doc_type = 'other' where doc_type in ('assignment', 'sublease', 'guaranty');

alter table public.leases add constraint leases_doc_type_check
  check (doc_type in ('main_lease', 'amendment', 'addendum', 'commencement_letter', 'other'));
