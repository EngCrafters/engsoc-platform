import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * The Email Centre's routines (ADR 0028, migration 0036). Each checks email.send for the live
 * actor; the dispatch routines run without an actor, after Core authorized the worker.
 */

export type Audience = Partial<{
  categories: string[];
  institutions: string[];
  years: number[];
  disciplines: string[];
  interests: string[];
  statuses: ("member" | "graduate")[];
  squ: ("verified" | "pending" | "not_verified")[];
  leadership: ("chief" | "assistant_chief" | "any")[];
  committees: string[];
  teams: string[];
  include: string[];
  exclude: string[];
}>;

export type CampaignContent = {
  language: "en" | "ar" | "both";
  subjectEn: string | null;
  subjectAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
  audience: Audience;
};

export type CampaignStatus =
  "draft" | "queued" | "sending" | "completed" | "cancelled" | "halted";

export type DeliveryCounts = {
  pending: number;
  sending: number;
  accepted: number;
  delivered: number;
  failed: number;
  skipped: number;
  total: number;
};

export type Campaign = CampaignContent & {
  id: string;
  status: CampaignStatus;
  revision: number;
  createdAt: string;
  createdByEmail: string | null;
  updatedAt: string | null;
  queuedAt: string | null;
  queuedByEmail: string | null;
  recipientCount: number | null;
  testSentAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  haltedAt: string | null;
  haltReason: string | null;
};

export type CampaignDetail = {
  campaign: Campaign;
  counts: DeliveryCounts;
  problems: {
    email: string;
    name: string;
    status: "failed" | "skipped";
    attempts: number;
    error: string | null;
    skipReason: string | null;
    at: string;
  }[];
};

export type Recipient = {
  id: string;
  name: string;
  email: string;
  category: string | null;
  institution: string | null;
  year: number | null;
  discipline: string | null;
  status: string;
  squVerified: boolean;
  leader: boolean;
};

export type Claimed = {
  id: string;
  campaignId: string;
  email: string;
  name: string;
  attempt: number;
  language: "en" | "ar" | "both";
  subjectEn: string | null;
  subjectAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
};

type Result = { code: string } & Record<string, unknown>;

async function call<T extends Result = Result>(query: ReturnType<typeof sql>) {
  const rows = await db.execute<{ result: T }>(query);
  if (!rows.length) throw new Error("Email routine unavailable");
  return rows[0].result;
}

const json = (value: unknown) => sql`${JSON.stringify(value)}::text::jsonb`;

export const filterOptions = (actor: string) =>
  call(sql`SELECT private.email_filter_options(${actor}::uuid) AS result`);

export const audiencePreview = (
  actor: string,
  audience: Audience,
  search: string | null,
  offset: number
) =>
  call<
    Result & { count?: number; matching?: number; recipients?: Recipient[] }
  >(
    sql`SELECT private.email_audience_preview(${actor}::uuid, ${json(audience)}, ${search}::text, ${offset}::integer) AS result`
  );

export const searchMembers = (actor: string, query: string) =>
  call<
    Result & {
      members?: { id: string; name: string; email: string; status: string }[];
    }
  >(
    sql`SELECT private.email_search_members(${actor}::uuid, ${query}::text) AS result`
  );

export const memberNames = (actor: string, ids: string[]) =>
  call<Result & { members?: { id: string; name: string; email: string }[] }>(
    sql`SELECT private.email_member_names(${actor}::uuid, ${`{${ids.join(",")}}`}::uuid[]) AS result`
  );

export const saveCampaign = (
  actor: string,
  id: string | null,
  revision: number | null,
  content: CampaignContent
) =>
  call<Result & { id?: string; revision?: number; field?: string }>(
    sql`SELECT private.email_save_campaign(${actor}::uuid, ${id}::uuid, ${revision}::integer, ${json(content)}) AS result`
  );

export const listCampaigns = (actor: string, offset: number) =>
  call(
    sql`SELECT private.email_list_campaigns(${actor}::uuid, ${offset}::integer) AS result`
  );

export const getCampaign = (actor: string, id: string) =>
  call(
    sql`SELECT private.email_get_campaign(${actor}::uuid, ${id}::uuid) AS result`
  );

export const queueCampaign = (
  actor: string,
  id: string,
  revision: number,
  expected: number
) =>
  call<Result & { count?: number; recipients?: number }>(
    sql`SELECT private.email_queue_campaign(${actor}::uuid, ${id}::uuid, ${revision}::integer, ${expected}::integer) AS result`
  );

export const cancelCampaign = (actor: string, id: string) =>
  call(
    sql`SELECT private.email_cancel_campaign(${actor}::uuid, ${id}::uuid) AS result`
  );

export const recordTest = (
  actor: string,
  id: string,
  outcome: "accepted" | "failed"
) =>
  call<Result & { email?: string }>(
    sql`SELECT private.email_record_test(${actor}::uuid, ${id}::uuid, ${outcome}::text) AS result`
  );

export const listTemplates = (actor: string) =>
  call(sql`SELECT private.email_list_templates(${actor}::uuid) AS result`);

export const saveTemplate = (
  actor: string,
  id: string | null,
  revision: number | null,
  content: {
    name: string;
    subjectEn: string | null;
    subjectAr: string | null;
    bodyEn: string | null;
    bodyAr: string | null;
  }
) =>
  call(
    sql`SELECT private.email_save_template(${actor}::uuid, ${id}::uuid, ${revision}::integer, ${json(content)}) AS result`
  );

export const archiveTemplate = (actor: string, id: string) =>
  call(
    sql`SELECT private.email_archive_template(${actor}::uuid, ${id}::uuid) AS result`
  );

export const claimDeliveries = (
  limit: number,
  leaseSeconds: number,
  campaign: string | null
) =>
  call<Result & { deliveries?: Claimed[] }>(
    sql`SELECT private.email_claim_deliveries(${limit}::integer, ${leaseSeconds}::integer, ${campaign}::uuid) AS result`
  );

export const completeDelivery = (
  id: string,
  outcome: "accepted" | "retry" | "failed",
  providerId: string | null,
  error: string | null,
  invalidAddress: boolean
) =>
  call(
    sql`SELECT private.email_complete_delivery(${id}::uuid, ${outcome}::text, ${providerId}::text, ${error}::text, ${invalidAddress}::boolean) AS result`
  );

export const unsubscribeDelivery = (id: string) =>
  call(sql`SELECT private.email_unsubscribe(${id}::uuid) AS result`);

export const ownEmailPreferences = (actor: string) =>
  call<Result & { announcements?: boolean }>(
    sql`SELECT private.get_own_email_preferences(${actor}::uuid) AS result`
  );

export const setOwnEmailPreferences = (actor: string, announcements: boolean) =>
  call<Result & { announcements?: boolean }>(
    sql`SELECT private.set_own_email_preferences(${actor}::uuid, ${announcements}::boolean) AS result`
  );

export const EMAIL_MESSAGES: Record<string, string> = {
  SUCCESS: "Saved.",
  FORBIDDEN: "You need the Email Centre permission for this.",
  NOT_FOUND: "This message no longer exists.",
  VALIDATION_ERROR: "Check the message and the audience, then try again.",
  STALE_REVISION:
    "Someone else changed this draft. Reload it to see the latest version.",
  INVALID_TRANSITION: "This message is no longer a draft.",
  ALREADY_QUEUED:
    "This message has already been queued. It is never sent twice.",
  CONTENT_INCOMPLETE:
    "Add a subject and a message for each language you chose before sending.",
  EMPTY_AUDIENCE: "No eligible member matches this audience.",
  AUDIENCE_CHANGED:
    "The audience changed since you reviewed it. Check the new count and confirm again.",
  SENDING_DISABLED:
    "Sending is not configured yet. Drafts, audiences and previews still work.",
  SERVER_ERROR: "Something went wrong. Try again.",
};
