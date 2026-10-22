"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getManagerContext } from "@/lib/auth/manager";
import { inviteAuthUser } from "@/lib/auth/admin";
import {
  activateMembership,
  getMembershipApplication,
  processMembershipStorageDeletions,
  reviewMembershipApplication,
  setMembershipApprovalPolicy,
} from "@/lib/membership/server";

/**
 * Membership review actions (ADR 0017). The actor is always the verified
 * session user; the routines decide whether that user may act (Society Affairs
 * scope or Senior Management) and in which state. The applicant's email for an
 * invitation is read from the database, never from the form.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(form: FormData, key: string) {
  const values = form.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

export type MembershipActionState = {
  code: string;
  decision?: "verify" | "approve" | "reject";
  activation?: string;
} | null;

/**
 * After approval: find or invite the Auth identity, then write the member.
 * An invitation failure leaves the application approved, with activation
 * pending, so it can be retried without a second decision.
 */
async function activate(
  actorId: string,
  applicationId: string
): Promise<string> {
  const first = await activateMembership({
    actorId,
    applicationId,
    invitation: "none",
  });
  if (first.code !== "NEEDS_INVITATION") return first.code;
  const detail = await getMembershipApplication(actorId, applicationId);
  if (detail.code !== "SUCCESS") return detail.code;
  const invite = await inviteAuthUser(detail.application.email);
  if (invite.code === "EMAIL_RATE_LIMIT") return "INVITE_RATE_LIMITED";
  if (invite.code !== "SUCCESS" && invite.code !== "EMAIL_EXISTS")
    return "INVITE_UNAVAILABLE";
  const second = await activateMembership({
    actorId,
    applicationId,
    invitation: invite.code === "SUCCESS" ? "sent" : "none",
  });
  return second.code;
}

export async function reviewMembershipAction(
  _previous: MembershipActionState,
  form: FormData
): Promise<MembershipActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "AUTH_REQUIRED" };
  const applicationId = one(form, "applicationId");
  const revision = Number(one(form, "revision"));
  const decision = one(form, "decision");
  const rawNote = form.has("note") ? one(form, "note") : "";
  if (
    !applicationId ||
    !UUID.test(applicationId) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    (decision !== "verify" &&
      decision !== "approve" &&
      decision !== "reject") ||
    rawNote === null ||
    rawNote.length > 500
  )
    return { code: "VALIDATION_ERROR" };

  try {
    const result = await reviewMembershipApplication({
      actorId: manager.userId,
      applicationId,
      revision,
      decision,
      note: decision === "verify" ? null : rawNote.trim() || null,
    });
    if (result.code !== "SUCCESS") return { code: result.code, decision };
    // The decision queued the ID card's Storage object for deletion in the
    // same transaction; delete it once the reviewer has their answer.
    if (decision !== "verify") after(() => processMembershipStorageDeletions());
    const activation =
      decision === "approve"
        ? await activate(manager.userId, applicationId)
        : undefined;
    revalidatePath("/admin/membership");
    revalidatePath(`/admin/membership/${applicationId}`);
    return { code: "SUCCESS", decision, activation };
  } catch {
    return { code: "SERVER_ERROR", decision };
  }
}

export async function activateMembershipAction(
  _previous: MembershipActionState,
  form: FormData
): Promise<MembershipActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "AUTH_REQUIRED" };
  const applicationId = one(form, "applicationId");
  if (!applicationId || !UUID.test(applicationId))
    return { code: "VALIDATION_ERROR" };
  try {
    const activation = await activate(manager.userId, applicationId);
    revalidatePath(`/admin/membership/${applicationId}`);
    return {
      code:
        activation === "SUCCESS" || activation === "ALREADY_ACTIVE"
          ? "SUCCESS"
          : activation,
      activation,
    };
  } catch {
    return { code: "SERVER_ERROR" };
  }
}

export async function setMembershipPolicyAction(
  _previous: MembershipActionState,
  form: FormData
): Promise<MembershipActionState> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "AUTH_REQUIRED" };
  const policy = one(form, "policy");
  if (policy !== "two_step" && policy !== "single_step" && policy !== "unset")
    return { code: "VALIDATION_ERROR" };
  try {
    const result = await setMembershipApprovalPolicy(manager.userId, policy);
    revalidatePath("/admin/membership");
    return { code: result.code };
  } catch {
    return { code: "SERVER_ERROR" };
  }
}
