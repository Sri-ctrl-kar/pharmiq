-- ADR Connect India — Milestone 4: reviewer workflow.
--
-- * report_status_events: append-only history of reviewer status changes.
-- * review_report(): the only way to change a report's status. Runs as the signed-in
--   user's request (auth.uid()), re-checks the reviewer role, the allowed transitions,
--   the reopen note, and that the status has not changed since the reviewer loaded it.
-- Workflow (must match src/lib/review/status.ts):
--   submitted -> under_review; under_review -> submitted | reviewed;
--   reviewed -> under_review (note required).

create table public.report_status_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  reviewer_id uuid references auth.users (id) on delete set null,
  from_status public.report_status not null,
  to_status public.report_status not null,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create index report_status_events_report_idx
  on public.report_status_events (report_id, created_at);

alter table public.report_status_events enable row level security;
revoke all on public.report_status_events from anon, authenticated;
grant select on public.report_status_events to authenticated;

create policy "Reviewers read status history"
  on public.report_status_events for select to authenticated
  using (public.is_reviewer());

create function public.review_report(
  p_public_id text,
  p_expected public.report_status,
  p_next public.report_status,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_report public.reports%rowtype;
begin
  if not public.is_reviewer() then
    raise exception 'Reviewer role required' using errcode = '42501';
  end if;

  if not (
    (p_expected = 'submitted' and p_next = 'under_review')
    or (p_expected = 'under_review' and p_next in ('submitted', 'reviewed'))
    or (p_expected = 'reviewed' and p_next = 'under_review')
  ) then
    raise exception 'Status change not allowed' using errcode = '22023';
  end if;

  if p_expected = 'reviewed' and v_note is null then
    raise exception 'A note is required to reopen a review' using errcode = '22023';
  end if;

  if char_length(v_note) > 1000 then
    raise exception 'Note too long' using errcode = '22001';
  end if;

  select * into v_report from public.reports
  where public_id = p_public_id
  for update;

  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  if v_report.status <> p_expected then
    raise exception 'Status changed since it was loaded' using errcode = '40001';
  end if;

  update public.reports
  set status = p_next, updated_at = now()
  where id = v_report.id
  returning * into v_report;

  insert into public.report_status_events (report_id, reviewer_id, from_status, to_status, note)
  values (v_report.id, auth.uid(), p_expected, p_next, v_note);

  return jsonb_build_object('status', v_report.status, 'updated_at', v_report.updated_at);
end;
$$;

revoke execute on function public.review_report(text, public.report_status, public.report_status, text)
  from public, anon;
grant execute on function public.review_report(text, public.report_status, public.report_status, text)
  to authenticated;
