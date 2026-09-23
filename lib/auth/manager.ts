import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthServerClient } from "./server";
import {
  getLocalReviewCommittees,
  isLocalReviewModeActive,
} from "./local-review";

export type ManagerContext =
  | { kind: "anonymous" }
  | { kind: "unassigned"; userId: string; email: string | null }
  | {
      kind: "manager";
      userId: string;
      email: string | null;
      committees: ReadonlyArray<{ id: string; name: string }>;
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
      : { kind: "manager", userId: user.id, email, committees };
  }

  const { data: grants, error: grantsError } = await supabase
    .from("committee_managers")
    .select("committee_id")
    .is("revoked_at", null);

  if (grantsError) {
    throw new Error("Unable to verify committee authorization.");
  }

  const committeeIds = (grants ?? []).map((grant) => grant.committee_id);
  if (committeeIds.length === 0) {
    return { kind: "unassigned", userId: user.id, email };
  }

  const { data: committees, error: committeesError } = await supabase
    .from("committees")
    .select("id, name")
    .in("id", committeeIds)
    .order("name");

  if (committeesError || !committees) {
    throw new Error("Unable to verify committee authorization.");
  }
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
    committees: committees.map((committee) => ({
      id: committee.id,
      name: committee.name,
    })),
  };
}

export const getManagerContext = cache(async (): Promise<ManagerContext> =>
  resolveManagerContext(await createAuthServerClient())
);
