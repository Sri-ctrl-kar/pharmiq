-- SYNTHETIC demonstration records only. Invented for the HEALTHX 2026 demo; they do not
-- describe real people or real medicine safety signals. Mirrors
-- src/server/reports/demo-seed.ts. Run by `supabase db reset` (local) or manually.

insert into public.reports (
  public_id, submitted_at, status, reporter_type,
  patient_initials, patient_age_years, patient_sex, patient_state,
  reaction_description, reaction_onset_date, reaction_onset_time,
  reaction_outcome, medical_attention, other_medicines, medical_history,
  missing_fields, is_synthetic
) values
  ('ADR-2026-SYN001', '2026-09-02T05:30:00Z', 'submitted', 'patient',
   'AK', 34, 'female', 'Karnataka',
   '[Synthetic demo record] Itchy red rash on both arms noticed on the third day of the course.',
   '2026-08-30', null, 'recovering', 'clinic_or_doctor', null, null,
   '{}', true),
  ('ADR-2026-SYN002', '2026-09-10T11:15:00Z', 'under_review', 'caregiver',
   'RS', 71, 'male', 'Maharashtra',
   '[Synthetic demo record] Reported muscle aches in both legs and tiredness for about a week.',
   null, null, 'not_recovered', 'unknown',
   'Amlodipine 5 mg daily', 'Type 2 diabetes, high blood pressure',
   '{suspectedMedicines.0.startDate,suspectedMedicines.1.dose,reaction.onsetDate,reaction.medicalAttention}',
   true),
  ('ADR-2026-SYN003', '2026-09-21T08:45:00Z', 'reviewed', 'healthcare_professional',
   null, 8, 'female', 'Tamil Nadu',
   '[Synthetic demo record] Swelling around the eyes and hives about two hours after a dose.',
   '2026-09-19', '16:00', 'recovered', 'emergency_department',
   null, 'No known allergies reported', '{}', true)
on conflict (public_id) do nothing;

insert into public.report_medicines (report_id, position, name, dose, route, frequency, start_date)
select r.id, m.position, m.name, m.dose, m.route::public.medicine_route, m.frequency, m.start_date
from (values
  ('ADR-2026-SYN001', 1, 'Amoxicillin', '500 mg', 'oral', 'Three times a day', date '2026-08-28'),
  ('ADR-2026-SYN002', 1, 'Metformin', '500 mg', 'oral', 'Twice a day', null),
  ('ADR-2026-SYN002', 2, 'Atorvastatin', null, 'oral', 'Once at night', date '2026-07-15'),
  ('ADR-2026-SYN003', 1, 'Ibuprofen suspension', '100 mg', 'oral', 'Every 8 hours', date '2026-09-18')
) as m (public_id, position, name, dose, route, frequency, start_date)
join public.reports r on r.public_id = m.public_id
on conflict (report_id, position) do nothing;
