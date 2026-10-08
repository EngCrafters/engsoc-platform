const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Fixed deployment configuration is the authority, never Host/proxy headers. */
function applicationOrigin(request: Request): string | null {
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      const loopback = LOOPBACK_HOSTS.has(url.hostname);
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
          !(
            process.env.NODE_ENV !== "production" &&
            loopback &&
            url.protocol === "http:"
          )) ||
        (process.env.NODE_ENV === "production" && loopback)
      )
        return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === "production") return null;
  const url = new URL(request.url);
  return LOOPBACK_HOSTS.has(url.hostname) &&
    ["http:", "https:"].includes(url.protocol)
    ? url.origin
    : null;
}

/** An opaque/missing Origin never falls back to Referer or proxy headers. */
export function isSameOriginPost(request: Request): boolean {
  const expected = applicationOrigin(request);
  if (
    request.method !== "POST" ||
    !expected ||
    request.headers.get("origin") !== expected
  )
    return false;
  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      const url = new URL(referer);
      if (url.origin !== expected || url.username || url.password) return false;
    } catch {
      return false;
    }
  }
  return true;
}
