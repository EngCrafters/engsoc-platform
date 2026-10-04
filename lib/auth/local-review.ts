import "server-only";
import postgres from "postgres";

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
 * The committees `userId` actively manages, read directly from the local
 * review database. Mirrors the shape of the real committee-grant query in
 * `manager.ts`. Returns `[]` when local review mode is inactive.
 */
export async function getLocalReviewCommittees(
  userId: string
): Promise<ReadonlyArray<{ id: string; name: string }>> {
  const url = localReviewUrl();
  if (!url) return [];

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    return await sql<{ id: string; name: string }[]>`
      SELECT c.id, c.name
      FROM public.administrative_access cm
      JOIN public.committees c ON c.id = cm.committee_id
      WHERE cm.user_id = ${userId} AND cm.revoked_at IS NULL
        AND cm.access_level = 'COMMITTEE_MANAGER' AND c.slug IS NOT NULL
      ORDER BY c.name
    `;
  } catch {
    throw new Error("Unable to read local review committee grants.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
