import { cache } from "react";
import { sql } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/db";
import { createAuthServerClient } from "./server";
import { getLocalReviewAccess, isLocalReviewModeActive } from "./local-review";
import {
  committeesFor,
  parseAccess,
  type AccessLevel,
  type DashboardAccess,
  type DashboardCommittee,
} from "./permissions";

export type { AccessLevel, DashboardCommittee } from "./permissions";

export type ManagerContext =
  | { kind: "anonymous" }
  | { kind: "unassigned"; userId: string; email: string | null }
  | {
      kind: "manager";
      userId: string;
      email: string | null;
      /** The personal level, if any. Display only: authority comes from `access`. */
      accessLevel: AccessLevel | null;
      /** Every permission the person holds now, with its scope (ADR 0027). */
      access: DashboardAccess;
      /** Committees whose events the person can see (events.view). */
      committees: ReadonlyArray<DashboardCommittee>;
      /** Every live committee, for names and pickers. */
      allCommittees: ReadonlyArray<DashboardCommittee>;
    };

type AccessLoader = (userId: string) => Promise<{
  access: DashboardAccess;
  committees: DashboardCommittee[];
} | null>;

/** One routine call per request: the person's permissions and the live committees. */
async function loadAccessFromDatabase(userId: string) {
  const rows = await db.execute<{ result: unknown }>(
    sql`SELECT private.get_dashboard_access(${userId}::uuid) AS result`
  );
  return parseAccess(rows[0]?.result);
}

/**
 * Re-checks identity and the person's permissions for this request. Neither user metadata nor a
 * cached JWT role claim is authorization evidence; the database decides (private.get_dashboard_access),
 * and every routine checks again.
 */
export async function resolveManagerContext(
  supabase: SupabaseClient,
  loadAccess: AccessLoader = isLocalReviewModeActive()
    ? getLocalReviewAccess
    : loadAccessFromDatabase
): Promise<ManagerContext> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { kind: "anonymous" };
  const email = user.email ?? null;

  let loaded: Awaited<ReturnType<AccessLoader>>;
  try {
    loaded = await loadAccess(user.id);
  } catch {
    throw new Error("Unable to verify dashboard authorization.");
  }
  if (!loaded) throw new Error("Unable to verify dashboard authorization.");
  const { access, committees } = loaded;
  if (Object.keys(access.permissions).length === 0) {
    return { kind: "unassigned", userId: user.id, email };
  }
  return {
    kind: "manager",
    userId: user.id,
    email,
    accessLevel: access.level,
    access,
    committees: committeesFor({ access }, "events.view", committees),
    allCommittees: committees,
  };
}

export const getManagerContext = cache(async (): Promise<ManagerContext> =>
  resolveManagerContext(await createAuthServerClient())
);

export type Manager = Extract<ManagerContext, { kind: "manager" }>;
