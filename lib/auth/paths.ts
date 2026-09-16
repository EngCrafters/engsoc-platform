/**
 * Keep authentication redirects inside the admin area. This is deliberately
 * stricter than accepting any same-origin URL: callers never choose an
 * external origin or a non-admin route after a credential-bearing action.
 */
export function safeAdminReturnPath(
  value: string | null | undefined,
  fallback = "/admin/events"
) {
  if (!value) return fallback;

  try {
    const url = new URL(value, "https://internal.invalid");
    const isInternal = url.origin === "https://internal.invalid";
    const isAdminPath =
      url.pathname === "/admin" || url.pathname.startsWith("/admin/");

    if (!isInternal || !isAdminPath || value.includes("\\")) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
