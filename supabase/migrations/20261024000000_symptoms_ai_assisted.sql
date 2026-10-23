-- ADR Connect India — Milestone 3: structured symptoms and AI-assistance flag.
--
-- reaction_symptoms: short symptom phrases in the reporter's words (entered manually or
--   accepted by the reporter from AI suggestions). The free-text description is unchanged.
-- ai_assisted: the reporter applied AI-extracted suggestions; every value was shown to
--   and confirmed or edited by the reporter before submission. No AI output is stored.
--
-- submit_report is replaced to write both columns; existing grants are preserved by
-- CREATE OR REPLACE (still executable only by service_role).

alter table public.reports
  add column reaction_symptoms text[] not null default '{}'
    constraint reports_symptoms_count check (cardinality(reaction_symptoms) <= 10),
  add column ai_assisted boolean not null default false;

create or replace function public.submit_report(p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest_date constant date := (now() at time zone 'utc')::date + 1;
  v_medicines jsonb := coalesce(p_report -> 'suspected_medicines', '[]'::jsonb);
  v_symptoms jsonb := coalesce(p_report -> 'reaction_symptoms', '[]'::jsonb);
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
    medical_history, ai_assisted, missing_fields
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

