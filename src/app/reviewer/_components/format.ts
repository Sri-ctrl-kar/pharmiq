const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});
const dateOnly = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** Timestamp in India Standard Time, e.g. "10 Sept 2026, 11:30 am". */
export const formatDateTime = (iso: string) =>
  `${dateTime.format(new Date(iso))} IST`;

/** A reporter-provided calendar date (YYYY-MM-DD), shown without time-zone shifting. */
export const formatDate = (isoDate: string) =>
  dateOnly.format(new Date(`${isoDate}T00:00:00Z`));
