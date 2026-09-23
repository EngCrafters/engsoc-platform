import type { AdminRegistration } from "./types";

export function csvCell(value: string) {
  const safe = /^[\s]*(=|\+|-|@|\t|\r|\n)/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildRegistrationCsv(rows: AdminRegistration[]) {
  return (
    [
      "Attendee name,Attendee email,Registration status,Registered at",
      ...rows.map((row) =>
        [row.attendeeName, row.attendeeEmail, row.status, row.registeredAt]
          .map(csvCell)
          .join(",")
      ),
    ].join("\r\n") + "\r\n"
  );
}
