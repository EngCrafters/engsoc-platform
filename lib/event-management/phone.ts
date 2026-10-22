/** E.164 international form. Formatting is accepted; extensions/local-only numbers are not. */
export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[ ()-]/g, "");
  return /^\+[1-9][0-9]{6,14}$/.test(compact) ? compact : null;
}
