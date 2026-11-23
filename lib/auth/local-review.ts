import "server-only";
import postgres from "postgres";
import { parseAccess } from "./permissions";

/**
 * Local-only escape hatch so a developer running `/admin` for visual review
 * can resolve committee-manager scope from the same disposable database the
 * admin list/detail routines already read, instead of a real Supabase
 * project. This never runs in a deployed environment or in CI:
 *
 * - `VERCEL` must be unset. Vercel sets this on every deployment, and only
 *   Vercel sets it — unlike `NODE_ENV`, which this repo's own local review
 *   and E2E setup deliberately runs as `"production"` (`next build` +
 *   `next start`, matching what Vercel serves; see `tests/e2e/README.md`),
 *   so `NODE_ENV` alone cannot tell a real deployment apart from a local
 *   review server and must not be used as the guard here.
 * - The URL must resolve to `127.0.0.1` / `localhost` / `::1` — never a real
 *   host, even if the variable were somehow set on a real deployment.
 * - It requires its own env var, `UC02_LOCAL_REVIEW_DATABASE_URL`, which is
 *   never read anywhere else in the app and is not part of `.env.example`'s
 *   normal setup — it is exported only in the terminal session running the
 *   local review server, never committed or persisted to `.env.local`.
 *
 * Signed-in identity itself still comes from real Supabase Auth (see
 * `manager.ts`); this module only redirects the committee-grant lookup so the
 * shell, account page, event list and event detail agree during local
 * review. It changes nothing about how `app_runtime`, RLS, or the
 * maintenance routines work, and no production code path calls it.
 */

function localReviewUrl(): string | null {
  if (process.env.VERCEL) return null;
  const raw = process.env.UC02_LOCAL_REVIEW_DATABASE_URL;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  return localHosts.has(url.hostname) ? raw : null;
}

export function isLocalReviewModeActive(): boolean {
  return localReviewUrl() !== null;
}

/**
 * The person's dashboard access, read from the local review database through the same routine the
 * real path uses (private.get_dashboard_access, migration 0035), so the shell, account page and
 * every list agree during local review. Returns null when local review mode is inactive.
 */
export async function getLocalReviewAccess(userId: string) {
  const url = localReviewUrl();
  if (!url) return null;

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const [row] = await sql<{ result: unknown }[]>`
      SELECT private.get_dashboard_access(${userId}::uuid) AS result
    `;
    return parseAccess(row?.result);
  } catch {
    throw new Error("Unable to read local review dashboard access.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
