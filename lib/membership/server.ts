import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type {
  ApplicationStatus,
  ApprovalPolicy,
  ReviewDecision,
  ReviewerKind,
} from "./types";

/**
 * Dashboard access to membership applications. Every function takes the actor
 * from the caller's verified session (ADR 0015) and calls one fixed routine,
 * which re-checks the actor's live access and Society Affairs scope itself.
 * Nothing here decides who may review.
 */

export type MembershipOverview = {
  reviewer: ReviewerKind;
  policy: ApprovalPolicy | null;
  counts: {
    pending_review: number;
    verified: number;
    approved: number;
    rejected: number;
    activationPending: number;
  };
};

export type MembershipListItem = {
  id: string;
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  discipline: string;
  status: ApplicationStatus;
  submittedAt: string;
  decidedAt: string | null;
  activated: boolean;
  hasDocument: boolean;
};

export type MembershipApplicationDetail = {
  id: string;
  fullName: string;
  email: string;
  universityId: string;
  academicYear: number;
  discipline: string;
  interests: string[];
  consentVersion: string;
  consentAcceptedAt: string;
  status: ApplicationStatus;
  submittedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verifiedByEmail: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
  memberId: string | null;
  activatedAt: string | null;
  documentDeletedAt: string | null;
  revision: number;
  document: { mediaType: string; byteSize: number } | null;
};

export type MembershipHistoryEntry = {
  occurredAt: string;
  action: string;
  actorKind: string;
  actorEmail: string | null;
  changes: Record<string, unknown>;
};

export const MEMBERSHIP_FILTERS = [
  "pending_review",
  "verified",
  "approved",
  "rejected",
  "all",
] as const;
export type MembershipFilter = (typeof MEMBERSHIP_FILTERS)[number];
export const MEMBERSHIP_PAGE_SIZE = 25;

export function parseMembershipFilter(
  value: string | undefined
): MembershipFilter {
  return (MEMBERSHIP_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as MembershipFilter)
    : "pending_review";
}

export async function canReviewMembership(actorId: string): Promise<boolean> {
  const rows = await db.execute<{ allowed: boolean }>(
    sql`SELECT private.can_review_membership(${actorId}::uuid) AS allowed`
  );
  return rows[0]?.allowed === true;
}

export async function getMembershipOverview(
  actorId: string
): Promise<MembershipOverview | null> {
  const rows = await db.execute<{
    result: { code: string } & Partial<MembershipOverview>;
  }>(
    sql`SELECT private.get_membership_review_overview(${actorId}::uuid) AS result`
  );
  const result = rows[0]?.result;
  if (!result || result.code !== "SUCCESS") return null;
  return {
    reviewer: result.reviewer!,
    policy: result.policy ?? null,
    counts: result.counts!,
  };
}

export type MembershipCursor = { submittedAt: string; id: string };

export async function listMembershipApplications(
  actorId: string,
  options: {
    filter: MembershipFilter;
    query: string | null;
    cursor: MembershipCursor | null;
  }
): Promise<{
  items: MembershipListItem[];
  nextCursor: MembershipCursor | null;
}> {
  const rows = await db.execute<{
    id: string;
    full_name: string;
    email: string;
    university_id: string;
    academic_year: number;
    discipline: string;
    status: ApplicationStatus;
    submitted_at: string;
    decided_at: string | null;
    activated: boolean;
    has_document: boolean;
    cursor_at: string;
  }>(sql`
    SELECT * FROM private.list_membership_applications(
      ${actorId}::uuid, ${options.filter}, ${options.query},
      ${options.cursor?.submittedAt ?? null}::text::timestamptz,
      ${options.cursor?.id ?? null}::uuid, ${MEMBERSHIP_PAGE_SIZE + 1}
    )
  `);
  const page = rows.slice(0, MEMBERSHIP_PAGE_SIZE);
  const items = page.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    universityId: row.university_id,
    academicYear: Number(row.academic_year),
    discipline: row.discipline,
    status: row.status,
    submittedAt: new Date(row.submitted_at).toISOString(),
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    activated: row.activated,
    hasDocument: row.has_document,
  }));
  // The routine's exact microsecond position, not the millisecond Date above.
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > MEMBERSHIP_PAGE_SIZE && last
        ? { submittedAt: last.cursor_at, id: last.id }
        : null,
  };
}

export type MembershipDetailResult =
  | {
      code: "SUCCESS";
      reviewer: ReviewerKind;
      policy: ApprovalPolicy | null;
      ownApplication: boolean;
      application: MembershipApplicationDetail;
    }
  | { code: "FORBIDDEN" | "NOT_FOUND" };

export async function getMembershipApplication(
  actorId: string,
  applicationId: string
): Promise<MembershipDetailResult> {
  const rows = await db.execute<{ result: MembershipDetailResult }>(sql`
    SELECT private.get_membership_application(${actorId}::uuid, ${applicationId}::uuid) AS result
  `);
  return rows[0]?.result ?? { code: "NOT_FOUND" };
}

export async function listMembershipHistory(
  actorId: string,
  applicationId: string
): Promise<MembershipHistoryEntry[]> {
  const rows = await db.execute<{
    occurred_at: string;
    action: string;
    actor_kind: string;
    actor_email: string | null;
    changes: Record<string, unknown>;
  }>(sql`
    SELECT * FROM private.list_membership_application_history(
      ${actorId}::uuid, ${applicationId}::uuid
    )
  `);
  return rows.map((row) => ({
    occurredAt: new Date(row.occurred_at).toISOString(),
    action: row.action,
    actorKind: row.actor_kind,
    actorEmail: row.actor_email,
    changes: row.changes,
  }));
}

/** The document bytes, recorded as viewed; null when the actor may not see it. */
export async function readMembershipDocument(
  actorId: string,
  applicationId: string
): Promise<{ mediaType: string; content: Buffer } | null> {
  const rows = await db.execute<{
    media_type: string;
    byte_size: number;
    sha256: string;
    content: Buffer;
  }>(sql`
    SELECT * FROM private.get_membership_document(${actorId}::uuid, ${applicationId}::uuid)
  `);
  const row = rows[0];
  if (!row) return null;
  return { mediaType: row.media_type, content: Buffer.from(row.content) };
}

export type ReviewCode =
  | "SUCCESS"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_REVISION"
  | "SELF_REVIEW"
  | "INVALID_TRANSITION"
  | "POLICY_NOT_CONFIRMED"
  | "VERIFICATION_REQUIRED"
  | "SENIOR_APPROVAL_REQUIRED"
  | "SECOND_REVIEWER_REQUIRED";

export async function reviewMembershipApplication(input: {
  actorId: string;
  applicationId: string;
  revision: number;
  decision: ReviewDecision;
  note: string | null;
}): Promise<{
  code: ReviewCode;
  status?: ApplicationStatus;
  revision?: number;
}> {
  const rows = await db.execute<{ result: { code: ReviewCode } }>(sql`
    SELECT private.review_membership_application(
      ${input.actorId}::uuid, ${input.applicationId}::uuid,
      ${input.revision}::integer, ${input.decision}, ${input.note}
    ) AS result
  `);
  return rows[0]?.result ?? { code: "NOT_FOUND" };
}

export type ActivationCode =
  | "SUCCESS"
  | "ALREADY_ACTIVE"
  | "NEEDS_INVITATION"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SELF_REVIEW"
  | "INVALID_TRANSITION"
  | "POLICY_NOT_CONFIRMED";

export async function activateMembership(input: {
  actorId: string;
  applicationId: string;
  invitation: "none" | "sent";
}): Promise<{ code: ActivationCode; memberId?: string }> {
  const rows = await db.execute<{ result: { code: ActivationCode } }>(sql`
    SELECT private.activate_membership(
      ${input.actorId}::uuid, ${input.applicationId}::uuid, ${input.invitation}
    ) AS result
  `);
  return rows[0]?.result ?? { code: "NOT_FOUND" };
}

export async function setMembershipApprovalPolicy(
  actorId: string,
  policy: ApprovalPolicy | "unset"
): Promise<{ code: "SUCCESS" | "FORBIDDEN" | "VALIDATION_ERROR" }> {
  const rows = await db.execute<{
    result: { code: "SUCCESS" | "FORBIDDEN" | "VALIDATION_ERROR" };
  }>(
    sql`SELECT private.set_membership_approval_policy(${actorId}::uuid, ${policy}) AS result`
  );
  return rows[0]?.result ?? { code: "VALIDATION_ERROR" };
}
