-- ADR Connect India — Milestone 6: structured medicine entries.
--
-- A report now lists every relevant medicine (up to 10), each with its own course and
-- product details, and the reporter marks which ones they suspect — or says they are not
-- sure. Nothing is inferred: is_suspected is only what the reporter ticked.
--
-- Backward compatibility
--   * Existing report_medicines rows were all suspected medicines (the earlier form only
--     listed those), so they are backfilled with is_suspected = true. New rows must state
--     it explicitly (no default afterwards).
--   * Existing reports get suspected_selection = 'marked'.
--   * submit_report still accepts the older `suspected_medicines` key (all suspected).
--
-- Grants are unchanged: submit_report stays executable only by service_role (CREATE OR
-- REPLACE keeps them); RLS on report_medicines is unchanged (reviewers read only).
-- Enum values must match src/lib/reports/constants.ts.

create type public.medicine_course_status as enum (
  'currently_taking', 'completed', 'stopped', 'dose_changed'
);
create type public.product_detail_source as enum (
  'pack_or_label', 'prescription', 'pharmacy_record', 'memory', 'other'
);

alter table public.reports
  add column suspected_selection text not null default 'marked'
    constraint reports_suspected_selection_check
    check (suspected_selection in ('marked', 'not_sure'));

alter table public.report_medicines
  drop constraint report_medicines_position_check,
  add constraint report_medicines_position_check check (position between 1 and 10),
  add column is_suspected boolean not null default true,
  add column brand text check (char_length(brand) <= 200),
  add column strength text check (char_length(strength) <= 100),
  add column end_date date check (end_date >= date '1900-01-01'),
  add column course_status public.medicine_course_status,
  add column previous_dose text check (char_length(previous_dose) <= 100),
  add column previous_frequency text check (char_length(previous_frequency) <= 100),
  add column change_date date check (change_date >= date '1900-01-01'),
  add column manufacturer text check (char_length(manufacturer) <= 200),
  add column batch_number text
    check (batch_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,39}$'),
  add column expiry_month text
    check (expiry_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  add column details_source public.product_detail_source,
  add constraint report_medicines_end_after_start
    check (end_date is null or start_date is null or end_date >= start_date),
  add constraint report_medicines_no_end_while_taking
    check (end_date is null or course_status is distinct from 'currently_taking'),
  add constraint report_medicines_change_needs_status
    check (
      (previous_dose is null and previous_frequency is null and change_date is null)
      or course_status = 'dose_changed'
    );

-- Backfill done; from now on every row must say whether the reporter suspected it.
alter table public.report_medicines alter column is_suspected drop default;

create or replace function public.submit_report(p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_date constant date := (now() at time zone 'utc')::date + 1;
  -- Reports from before Milestone 6 send `suspected_medicines` (all suspected).
  v_legacy constant boolean := not (p_report ? 'medicines');
  v_medicines jsonb := coalesce(
    p_report -> 'medicines', p_report -> 'suspected_medicines', '[]'::jsonb
  );
  v_selection text := coalesce(p_report ->> 'suspected_selection', 'marked');
  v_symptoms jsonb := coalesce(p_report -> 'reaction_symptoms', '[]'::jsonb);
  v_suspected_count integer;
  v_report public.reports%rowtype;
  v_medicine jsonb;
  v_position smallint := 0;
begin
  if p_report ->> 'idempotency_key' is null then
    raise exception 'idempotency_key is required' using errcode = '22023';
  end if;

  if jsonb_typeof(v_medicines) <> 'array'
     or jsonb_array_length(v_medicines) not between 1 and 10 then
    raise exception 'A report needs between 1 and 10 medicines'
      using errcode = '22023';
  end if;

  if v_selection not in ('marked', 'not_sure') then
    raise exception 'suspected_selection must be marked or not_sure'
      using errcode = '22023';
  end if;

  select count(*) into v_suspected_count
  from jsonb_array_elements(v_medicines) m
  where v_legacy or coalesce((m ->> 'is_suspected')::boolean, false);

  if v_selection = 'marked' and v_suspected_count = 0 then
    raise exception 'Mark at least one suspected medicine, or choose not sure'
      using errcode = '22023';
  end if;
  if v_selection = 'not_sure' and v_suspected_count > 0 then
    raise exception 'No medicine can be marked suspected when the reporter is not sure'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_symptoms) <> 'array' or jsonb_array_length(v_symptoms) > 10
     or exists (
       select 1 from jsonb_array_elements(v_symptoms) s
       where jsonb_typeof(s) <> 'string'
          or char_length(btrim(s #>> '{}')) not between 2 and 100
     ) then
    raise exception 'Symptoms must be 0 to 10 entries of 2 to 100 characters'
      using errcode = '22023';
  end if;

  if (p_report ->> 'reaction_onset_date')::date > v_latest_date then
    raise exception 'Reaction onset date is in the future' using errcode = '22007';
  end if;

  insert into public.reports (
    public_id, idempotency_key, reporter_type,
    patient_initials, patient_age_years, patient_sex, patient_state,
    reaction_description, reaction_onset_date, reaction_onset_time,
    reaction_symptoms, reaction_outcome, medical_attention, other_medicines,
    medical_history, ai_assisted, missing_fields, suspected_selection
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
    array(select btrim(s) from jsonb_array_elements_text(v_symptoms) as s),
    (p_report ->> 'reaction_outcome')::public.reaction_outcome,
    (p_report ->> 'medical_attention')::public.medical_attention,
    p_report ->> 'other_medicines',
    p_report ->> 'medical_history',
    coalesce((p_report ->> 'ai_assisted')::boolean, false),
    coalesce(
      array(select jsonb_array_elements_text(p_report -> 'missing_fields')),
      '{}'
    ),
    v_selection
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
    if (v_medicine ->> 'start_date')::date > v_latest_date
       or (v_medicine ->> 'end_date')::date > v_latest_date
       or (v_medicine ->> 'change_date')::date > v_latest_date then
      raise exception 'Medicine dates cannot be in the future' using errcode = '22007';
    end if;
    insert into public.report_medicines (
      report_id, position, name, brand, strength, dose, route, frequency,
      start_date, end_date, course_status, previous_dose, previous_frequency,
      change_date, manufacturer, batch_number, expiry_month, details_source,
      is_suspected
    ) values (
      v_report.id,
      v_position,
      v_medicine ->> 'name',
      v_medicine ->> 'brand',
      v_medicine ->> 'strength',
      v_medicine ->> 'dose',
      (v_medicine ->> 'route')::public.medicine_route,
      v_medicine ->> 'frequency',
      (v_medicine ->> 'start_date')::date,
      (v_medicine ->> 'end_date')::date,
      (v_medicine ->> 'course_status')::public.medicine_course_status,
      v_medicine ->> 'previous_dose',
      v_medicine ->> 'previous_frequency',
      (v_medicine ->> 'change_date')::date,
      v_medicine ->> 'manufacturer',
      v_medicine ->> 'batch_number',
      v_medicine ->> 'expiry_month',
      (v_medicine ->> 'details_source')::public.product_detail_source,
      v_legacy or coalesce((v_medicine ->> 'is_suspected')::boolean, false)
    );
  end loop;

  return jsonb_build_object(
    'report_id', v_report.public_id,
    'submitted_at', v_report.submitted_at,
    'duplicate', false
  );
end;
$$;
