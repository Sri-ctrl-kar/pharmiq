-- ADR Connect India — Milestone 2: core report storage.
--
-- Access model
--   * anon / authenticated: NO direct insert/update/delete on any table, and cannot call
--     submit_report. Reports are only written by the Next.js server (service_role) after
--     server-side validation.
--   * submit_report() re-validates the payload in SQL (defence in depth) and writes a
--     report and its medicines in one transaction.
--   * Reviewers/admins (profiles.role) may read reports via RLS. Review actions arrive
--     in Milestone 5.
-- Enum values must match src/lib/reports/constants.ts.

create type public.reporter_type as enum ('patient', 'caregiver', 'healthcare_professional');
create type public.patient_sex as enum ('female', 'male', 'other', 'unknown');
create type public.medicine_route as enum (
  'oral', 'topical', 'injection_iv', 'injection_im', 'injection_sc', 'inhaled',
  'eye_ear_nose', 'other', 'unknown'
);
create type public.reaction_outcome as enum (
  'recovered', 'recovering', 'not_recovered', 'recovered_with_sequelae', 'fatal', 'unknown'
);
create type public.medical_attention as enum (
  'none', 'clinic_or_doctor', 'emergency_department', 'hospitalised', 'unknown'
);
create type public.report_status as enum (
  'submitted', 'under_review', 'needs_info', 'reviewed', 'closed'
);
create type public.user_role as enum ('reporter', 'reviewer', 'admin');

-- Roles. Users cannot change their own role (no insert/update grants).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'reporter',
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  public_id text not null
    constraint reports_public_id_key unique
    constraint reports_public_id_format check (public_id ~ '^ADR-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'),
  -- Null only for seeded synthetic records.
  idempotency_key uuid constraint reports_idempotency_key_key unique,
  submitted_at timestamptz not null default now(),
  status public.report_status not null default 'submitted',
  reporter_type public.reporter_type not null,
  patient_initials text check (patient_initials ~ '^[A-Z]{1,4}$'),
  patient_age_years smallint check (patient_age_years between 0 and 120),
  patient_sex public.patient_sex,
  patient_state text check (char_length(patient_state) <= 60),
  reaction_description text not null
    check (char_length(btrim(reaction_description)) between 10 and 4000),
  reaction_onset_date date check (reaction_onset_date >= date '1900-01-01'),
  reaction_onset_time time,
  reaction_outcome public.reaction_outcome not null,
  medical_attention public.medical_attention not null,
  other_medicines text check (char_length(other_medicines) <= 2000),
  medical_history text check (char_length(medical_history) <= 2000),
  missing_fields text[] not null default '{}',
  is_synthetic boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint reports_onset_time_needs_date
    check (reaction_onset_time is null or reaction_onset_date is not null)
);

create index reports_submitted_at_idx on public.reports (submitted_at desc);
create index reports_status_idx on public.reports (status);

create table public.report_medicines (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  name text not null check (char_length(btrim(name)) between 2 and 200),
  dose text check (char_length(dose) <= 100),
  route public.medicine_route,
  frequency text check (char_length(frequency) <= 100),
  start_date date check (start_date >= date '1900-01-01'),
  constraint report_medicines_position_key unique (report_id, position)
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.report_medicines enable row level security;

-- Supabase grants broad table privileges to anon/authenticated by default; remove them.
revoke all on public.profiles, public.reports, public.report_medicines from anon, authenticated;
grant select on public.profiles, public.reports, public.report_medicines to authenticated;

create function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('reviewer', 'admin')
  );
$$;

revoke execute on function public.is_reviewer() from public, anon;
grant execute on function public.is_reviewer() to authenticated;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "Reviewers read reports"
  on public.reports for select to authenticated
  using (public.is_reviewer());

create policy "Reviewers read report medicines"
  on public.report_medicines for select to authenticated
  using (public.is_reviewer());

-- ---------------------------------------------------------------------------
-- submit_report: the only write path for new reports.
-- Status, synthetic flag and timestamps are set here, never taken from the caller.
-- ---------------------------------------------------------------------------
create function public.submit_report(p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_date constant date := (now() at time zone 'utc')::date + 1;
  v_medicines jsonb := coalesce(p_report -> 'suspected_medicines', '[]'::jsonb);
  v_report public.reports%rowtype;
  v_medicine jsonb;
  v_position smallint := 0;
begin
  if p_report ->> 'idempotency_key' is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if jsonb_typeof(v_medicines) <> 'array'
     or jsonb_array_length(v_medicines) not between 1 and 5 then
    raise exception 'A report needs between 1 and 5 suspected medicines'
      using errcode = '22023';
  end if;

  if (p_report ->> 'reaction_onset_date')::date > v_latest_date then
    raise exception 'Reaction onset date is in the future' using errcode = '22007';
  end if;

  insert into public.reports (
    public_id, idempotency_key, reporter_type,
    patient_initials, patient_age_years, patient_sex, patient_state,
    reaction_description, reaction_onset_date, reaction_onset_time,
    reaction_outcome, medical_attention, other_medicines, medical_history,
    missing_fields
  ) values (
    p_report ->> 'public_id',
    (p_report ->> 'idempotency_key')::uuid,
    (p_report ->> 'reporter_type')::public.reporter_type,
    p_report ->> 'patient_initials',
    (p_report ->> 'patient_age_years')::smallint,
    (p_report ->> 'patient_sex')::public.patient_sex,
    p_report ->> 'patient_state',
    p_report ->> 'reaction_description',
    (p_report ->> 'reaction_onset_date')::date,
    (p_report ->> 'reaction_onset_time')::time,
    (p_report ->> 'reaction_outcome')::public.reaction_outcome,
    (p_report ->> 'medical_attention')::public.medical_attention,
    p_report ->> 'other_medicines',
    p_report ->> 'medical_history',
    coalesce(
      array(select jsonb_array_elements_text(p_report -> 'missing_fields')),
      '{}'
    )
  )
  on conflict (idempotency_key) do nothing
  returning * into v_report;

  if v_report.id is null then
    -- Same idempotency key already stored: return the original report.
    select * into v_report from public.reports
    where idempotency_key = (p_report ->> 'idempotency_key')::uuid;
    return jsonb_build_object(
      'report_id', v_report.public_id,
      'submitted_at', v_report.submitted_at,
      'duplicate', true
    );
  end if;

  for v_medicine in select value from jsonb_array_elements(v_medicines) loop
    v_position := v_position + 1;
    if (v_medicine ->> 'start_date')::date > v_latest_date then
      raise exception 'Medicine start date is in the future' using errcode = '22007';
    end if;
    insert into public.report_medicines (report_id, position, name, dose, route, frequency, start_date)
    values (
      v_report.id,
      v_position,
      v_medicine ->> 'name',
      v_medicine ->> 'dose',
      (v_medicine ->> 'route')::public.medicine_route,
      v_medicine ->> 'frequency',
      (v_medicine ->> 'start_date')::date
    );
  end loop;

  return jsonb_build_object(
    'report_id', v_report.public_id,
    'submitted_at', v_report.submitted_at,
    'duplicate', false
  );
end;
$$;

revoke execute on function public.submit_report(jsonb) from public, anon, authenticated;
grant execute on function public.submit_report(jsonb) to service_role;
