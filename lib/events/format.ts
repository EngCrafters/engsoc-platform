const muscatDateTime = new Intl.DateTimeFormat("en-OM", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Muscat",
  timeZoneName: "short",
});
const muscatFullDateTime = new Intl.DateTimeFormat("en-OM", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Muscat",
  timeZoneName: "short",
});

export function formatEventDate(date: Date, detail = false) {
  return (detail ? muscatFullDateTime : muscatDateTime).format(date);
}
