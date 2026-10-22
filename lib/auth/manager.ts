import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthServerClient } from "./server";
import {
  getLocalReviewCommittees,
  isLocalReviewModeActive,
} from "./local-review";

export type AccessLevel = "COMMITTEE_MANAGER" | "BOARD_ADMIN" | "TECHNICAL";

export type ManagerContext =
  | { kind: "anonymous" }
  | { kind: "unassigned"; userId: string; email: string | null }
  | {
      kind: "manager";
      userId: string;
      email: string | null;
      accessLevel: AccessLevel;
      /** `slug` is the stable committee identifier (null for legacy rows). */
      committees: ReadonlyArray<{
        id: string;
        name: string;
        slug?: string | null;
        /** Archived committees keep their records but take no new events or managers. */
        archived?: boolean;
      }>;
    };

/**
 * Re-checks identity and active committee grants for this request. Neither
 * user metadata nor a cached JWT role claim is authorization evidence.
 */
export async function resolveManagerContext(
  supabase: SupabaseClient
): Promise<ManagerContext> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return { kind: "anonymous" };
  const email = user.email ?? null;

  // Local review only (see local-review.ts): identity above still comes from
  // real Supabase Auth, but scope is read from the same disposable database
  // the admin list/detail routines use, so the shell, account page, list and
  // detail agree. Inert everywhere else — production and CI never set the
  // env var this checks.
  if (isLocalReviewModeActive()) {
    const committees = await getLocalReviewCommittees(user.id);
    return committees.length === 0
      ? { kind: "unassigned", userId: user.id, email }
      : {
          kind: "manager",
          userId: user.id,
          email,
          accessLevel: "COMMITTEE_MANAGER",
          committees,
        };
  }

  const { data: access, error: grantsError } = await supabase
    .from("administrative_access")
    .select("access_level, committee_id")
    .is("revoked_at", null)
    .maybeSingle();

  if (grantsError) {
    throw new Error("Unable to verify committee authorization.");
  }

  if (!access) {
    return { kind: "unassigned", userId: user.id, email };
  }
  const level = access.access_level as AccessLevel;
  if (!["COMMITTEE_MANAGER", "BOARD_ADMIN", "TECHNICAL"].includes(level)) {
    throw new Error("Unable to verify committee authorization.");
  }
  if (level === "COMMITTEE_MANAGER" && !access.committee_id) {
    throw new Error("Unable to verify committee authorization.");
  }

  // `*` rather than named columns: `archived_at` exists from migration 0032 on (ADR 0024), and an
  // archived committee is not offered for new events or assignments.
  const query = supabase.from("committees").select("*");
  const { data: rows, error: committeesError } =
    level === "COMMITTEE_MANAGER"
      ? await query.in("id", [access.committee_id!]).order("name")
      : await query.not("slug", "is", null).order("name");

  if (committeesError || !rows) {
    throw new Error("Unable to verify committee authorization.");
  }
  const committees = rows as {
    id: string;
    name: string;
    slug: string | null;
    archived_at?: string | null;
  }[];
  // A grant can be revoked between the two caller-scoped reads. Use only the
  // second query's still-authorized committees rather than surfacing stale
  // scope or treating a concurrent revocation as an application failure.
  if (committees.length === 0) {
    return { kind: "unassigned", userId: user.id, email };
  }

  return {
    kind: "manager",
    userId: user.id,
    email,
    accessLevel: level,
    committees: committees.map((committee) => ({
      id: committee.id,
      name: committee.name,
      slug: committee.slug,
      ...(committee.archived_at ? { archived: true } : {}),
    })),
  };
}

export const getManagerContext = cache(async (): Promise<ManagerContext> =>
  resolveManagerContext(await createAuthServerClient())
);
