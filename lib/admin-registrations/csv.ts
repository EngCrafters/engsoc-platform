import type { AdminRegistration } from "./types";

export function csvCell(value: string) {
  const safe = /^[\s]*(=|\+|-|@|\t|\r|\n)/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildRegistrationCsv(rows: AdminRegistration[]) {
  return (
    [
      "Attendee name,Attendee email,Attendee phone,Registration status,Registered at",
      ...rows.map((row) =>
        [
          row.attendeeName,
          row.attendeeEmail,
          // A registration captured before the phone field existed exports as an
          // empty cell. Never "N/A" or a placeholder: an empty cell is what a
          // spreadsheet expects for "not captured", and it stays honest.
          row.attendeePhone ?? "",
          row.status,
          row.registeredAt,
        ]
          .map(csvCell)
          .join(",")
      ),
    ].join("\r\n") + "\r\n"
  );
}
