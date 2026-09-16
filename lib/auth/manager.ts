import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthServerClient } from "./server";

export type ManagerContext =
  | { kind: "anonymous" }
  | { kind: "unassigned"; userId: string }
  | {
      kind: "manager";
      userId: string;
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

  const { data: grants, error: grantsError } = await supabase
    .from("committee_managers")
    .select("committee_id")
    .is("revoked_at", null);

  if (grantsError) {
    throw new Error("Unable to verify committee authorization.");
  }

  const committeeIds = (grants ?? []).map((grant) => grant.committee_id);
  if (committeeIds.length === 0) return { kind: "unassigned", userId: user.id };

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
  if (committees.length === 0) return { kind: "unassigned", userId: user.id };

  return {
    kind: "manager",
    userId: user.id,
    committees: committees.map((committee) => ({
      id: committee.id,
      name: committee.name,
    })),
  };
}

export const getManagerContext = cache(async (): Promise<ManagerContext> =>
  resolveManagerContext(await createAuthServerClient())
);
