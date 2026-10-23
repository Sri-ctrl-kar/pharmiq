export const siteConfig = {
  name: "ADR Connect India",
  tagline: "Report suspected medicine reactions, clearly and safely.",
  description:
    "An AI-assisted platform for patients, caregivers and healthcare professionals to report suspected adverse drug reactions. HEALTHX 2026 hackathon prototype.",
} as const;

export type NavItem = { href: string; label: string };

export const mainNav: NavItem[] = [
  { href: "/report", label: "Report a reaction" },
  { href: "/dashboard", label: "Analytics" },
  { href: "/reviewer", label: "Reviewer" },
];

/**
 * Safety copy shown across the product. Kept in one place so wording stays
 * consistent and reviewable.
 */
export const safetyCopy = {
  notMedicalAdvice:
    "This service records suspected reactions. It does not diagnose conditions, decide whether a medicine caused a reaction, or give medical advice.",
  doNotStopMedication:
    "Do not stop or change any prescribed medicine because of this report. Talk to your doctor or pharmacist first.",
  emergency:
    "If you or someone else has severe symptoms such as difficulty breathing, swelling of the face or throat, or loss of consciousness, call 112 or go to the nearest emergency department now.",
  notOfficial:
    "ADR Connect India is an independent hackathon prototype. It is not affiliated with, endorsed by, or integrated with the Pharmacovigilance Programme of India (PvPI), IPC or CDSCO.",
  notSentToPvpi:
    "This report is recorded in ADR Connect India only. It has not been sent to the Pharmacovigilance Programme of India (PvPI), CDSCO or any other regulator.",
  localDemoStorage:
    "Demonstration storage: reports are saved to a local file on this server, which is not a secure production database. Use made-up or test details only — do not enter real patient information.",
  syntheticData:
    "All analytics in this demonstration use synthetic data generated for testing. They do not describe real patients or real medicine safety signals.",
} as const;
