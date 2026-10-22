import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * The Administration section (ADR 0024). Every routine takes the verified actor and decides in
 * PostgreSQL what that actor may see or change; nothing here trusts a role from the browser.
 */
export type Result = { code: string; field?: string } & Record<string, unknown>;

async function call(query: ReturnType<typeof sql>): Promise<Result> {
  const rows = await db.execute<{ result: Result }>(query);
  if (!rows.length) throw new Error("Administration operation unavailable");
  return rows[0].result;
}

/**
 * The private buckets files are deleted from, read from server configuration only. The database
 * validates every key; a missing bucket makes a deletion that needs it refuse rather than orphan
 * a file.
 */
export function deletionBuckets() {
  const bucket = (value: string | undefined) => value?.trim() || null;
  return {
    events: bucket(process.env.SUPABASE_S3_EVENT_BUCKET),
    projects: bucket(process.env.SUPABASE_S3_PROJECT_BUCKET),
    photos: bucket(process.env.SUPABASE_S3_MEMBER_PHOTO_BUCKET),
  };
}

export type ActivityRow = {
  id: string;
  occurredAt: string;
  action: string;
  actorKind: string;
  actor: string | null;
  committee: string | null;
  subject: string | null;
};

export type Overview = {
  code: "SUCCESS";
  level: "BOARD_ADMIN" | "TECHNICAL";
  committees: { active: number; archived: number };
  access: {
    technical: number;
    board: number;
    managers: number;
    suspended: number;
  };
  members: { total: number; graduates: number };
  applications: number;
  corrections: number;
  events: { draft: number; live: number; archived: number };
  projects: { total: number; published: number; inReview: number };
  storageCleanup: number;
  pendingErasures: number;
  recent: ActivityRow[];
};

export const adminOverview = (actor: string) =>
  call(sql`SELECT private.admin_overview(${actor}::uuid) AS result`);

export type CommitteeSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  archivedAt: string | null;
  protected: boolean;
  managers: { userId: string; email: string }[];
  members: number;
  events: number;
  upcomingEvents: number;
  projects: number;
};

export const listCommittees = (actor: string) =>
  call(sql`SELECT private.admin_list_committees(${actor}::uuid) AS result`);

export type CommitteeDetail = {
  committee: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    archivedAt: string | null;
    updatedAt: string | null;
    protected: boolean;
  };
  managers: {
    userId: string;
    email: string;
    active: boolean;
    grantedAt: string;
    revokedAt: string | null;
    revocationKind: "revoked" | "suspended" | null;
  }[];
  members: {
    memberId: string;
    name: string;
    email: string;
    universityId: string;
    discipline: string | null;
    year: number | null;
    responsibility: string | null;
    addedAt: string;
  }[];
  stats: {
    events: number;
    liveEvents: number;
    upcomingEvents: number;
    projects: number;
  };
  activity: ActivityRow[];
};

export const getCommittee = (actor: string, committee: string) =>
  call(
    sql`SELECT private.admin_get_committee(${actor}::uuid, ${committee}::uuid) AS result`
  );

export const createCommittee = (
  actor: string,
  input: { name: string; slug: string; description: string | null }
) =>
  call(sql`SELECT private.admin_create_committee(${actor}::uuid, ${input.name}::text,
    ${input.slug}::text, ${input.description}::text) AS result`);

export const updateCommittee = (
  actor: string,
  committee: string,
  input: { name: string; description: string | null }
) =>
  call(sql`SELECT private.admin_update_committee(${actor}::uuid, ${committee}::uuid,
    ${input.name}::text, ${input.description}::text) AS result`);

export const setCommitteeArchived = (
  actor: string,
  committee: string,
  archived: boolean
) =>
  call(sql`SELECT private.admin_set_committee_archived(${actor}::uuid, ${committee}::uuid,
    ${archived}::boolean) AS result`);

export const changeCommitteeMember = (
  actor: string,
  committee: string,
  member: string,
  operation: "add" | "update" | "remove",
  responsibility: string | null
) =>
  call(sql`SELECT private.admin_change_committee_member(${actor}::uuid, ${committee}::uuid,
    ${member}::uuid, ${operation}::text, ${responsibility}::text) AS result`);

export const setAccessSuspension = (
  actor: string,
  user: string,
  suspend: boolean,
  note: string | null
) =>
  call(sql`SELECT private.set_access_suspension(${actor}::uuid, ${user}::uuid,
    ${suspend}::boolean, ${note}::text) AS result`);

export type MemberFilter = "all" | "member" | "graduate" | "admin";
export type MemberRow = {
  id: string;
  name: string;
  email: string;
  universityId: string;
  year: number | null;
  discipline: string | null;
  status: "member" | "graduate";
  createdAt: string;
  hasPhoto: boolean;
  registrations: number;
  projects: number;
  committees: string[];
  adminLevel: "COMMITTEE_MANAGER" | "BOARD_ADMIN" | "TECHNICAL" | null;
};

export const listMembers = (
  actor: string,
  search: string,
  filter: MemberFilter,
  offset: number
) =>
  call(sql`SELECT private.admin_list_members(${actor}::uuid, ${search}::text,
    ${filter}::text, ${offset}::integer) AS result`);

export type MemberDetail = {
  member: {
    id: string;
    name: string;
    email: string;
    universityId: string;
    year: number | null;
    discipline: string | null;
    status: "member" | "graduate";
    interests: string[];
    hasPhoto: boolean;
    createdAt: string;
    updatedAt: string | null;
  };
  account: {
    email: string;
    confirmed: boolean;
    createdAt: string;
    lastSignInAt: string | null;
  } | null;
  access: {
    level: string;
    committee: string | null;
    active: boolean;
    revocationKind: string | null;
  } | null;
  applications: {
    id: string;
    status: string;
    submittedAt: string;
    decidedAt: string | null;
    activatedAt: string | null;
  }[];
  projects: {
    id: string;
    title: string | null;
    status: string;
    published: boolean;
    updatedAt: string;
  }[];
  registrations: {
    eventId: string;
    title: string;
    eventDate: string;
    status: string;
    attended: boolean;
  }[];
  registrationCount: number;
  committees: {
    id: string;
    name: string;
    responsibility: string | null;
    archived: boolean;
  }[];
  changeRequests: { field: string; status: string; requestedAt: string }[];
};

export const getMember = (actor: string, member: string) =>
  call(
    sql`SELECT private.admin_get_member(${actor}::uuid, ${member}::uuid) AS result`
  );

// ------------------------------------------------------------------------------------------
// Permanent deletion: the preview is the same summary the deletion re-checks under lock.
// ------------------------------------------------------------------------------------------
export type DeletionBlocker =
  | "EVENT_ACTIVE"
  | "EVENT_HAS_REGISTRATIONS"
  | "CERTIFICATES_EXIST"
  | "PROJECT_PUBLISHED"
  | "MEMBER_HAS_PROJECTS"
  | "LEGACY_RECORDS"
  | "ACTIVE_ACCESS"
  | "ACCOUNTABILITY_RECORDS";

export type EventDeletionPreview = {
  id: string;
  title: string;
  confirmation: string;
  committee: string;
  status: string;
  archived: boolean;
  eventDate: string;
  registrations: number;
  confirmed: number;
  waitlisted: number;
  attended: number;
  memberRegistrations: number;
  checkinSessions: number;
  coverImage: boolean;
  certificates: number;
  auditEntries: number;
  blockers: DeletionBlocker[];
};

export type ProjectDeletionPreview = {
  id: string;
  title: string;
  confirmation: string;
  status: string;
  published: boolean;
  author: string | null;
  committee: string | null;
  media: number;
  history: number;
  blockers: DeletionBlocker[];
};

export type MemberDeletionPreview = {
  userId: string;
  mode: "membership" | "account";
  name: string | null;
  membershipEmail: string | null;
  signInEmail: string | null;
  hasMember: boolean;
  hasAccount: boolean;
  confirmation: string;
  registrations: number;
  applications: number;
  storedIdCards: number;
  changeRequests: number;
  committees: number;
  photo: boolean;
  projects: number;
  legacyRecords: number;
  activeAccess: string | null;
  formerAccess: boolean;
  accountabilityRecords: number;
  auditAsActor: number;
  pendingErasure: boolean;
  blockers: DeletionBlocker[];
};

export const previewEventDeletion = (actor: string, event: string) =>
  call(
    sql`SELECT private.preview_event_deletion(${actor}::uuid, ${event}::uuid) AS result`
  );

export const deleteEventPermanently = (
  actor: string,
  event: string,
  confirmation: string
) =>
  call(sql`SELECT private.delete_event_permanently(${actor}::uuid, ${event}::uuid,
    ${confirmation}::text, ${deletionBuckets().events}::text) AS result`);

export const previewProjectDeletion = (actor: string, project: string) =>
  call(
    sql`SELECT private.preview_project_deletion(${actor}::uuid, ${project}::uuid) AS result`
  );

export const deleteProjectPermanently = (
  actor: string,
  project: string,
  confirmation: string
) =>
  call(sql`SELECT private.delete_project_permanently(${actor}::uuid, ${project}::uuid,
    ${confirmation}::text, ${deletionBuckets().projects}::text) AS result`);

export const previewMemberDeletion = (
  actor: string,
  user: string,
  mode: "membership" | "account"
) =>
  call(sql`SELECT private.preview_member_deletion(${actor}::uuid, ${user}::uuid,
    ${mode}::text) AS result`);

export const deleteMemberRecord = (
  actor: string,
  member: string,
  confirmation: string
) =>
  call(sql`SELECT private.delete_member_record(${actor}::uuid, ${member}::uuid,
    ${confirmation}::text, ${deletionBuckets().photos}::text) AS result`);

export const eraseAccount = (
  actor: string,
  user: string,
  confirmation: string
) =>
  call(sql`SELECT private.erase_account(${actor}::uuid, ${user}::uuid,
    ${confirmation}::text, ${deletionBuckets().photos}::text) AS result`);

export const completeAccountErasure = (actor: string, erasure: string) =>
  call(
    sql`SELECT private.complete_account_erasure(${actor}::uuid, ${erasure}::uuid) AS result`
  );

export type PendingErasure = {
  id: string;
  userId: string;
  requestedAt: string;
  attempts: number;
  email: string | null;
};

export const listAccountErasures = (actor: string) =>
  call(sql`SELECT private.list_account_erasures(${actor}::uuid) AS result`);
