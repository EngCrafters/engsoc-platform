"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid, requirePermission } from "@/lib/administration/access";
import { logServerError } from "@/lib/api/log";
import { dispatchEmailBatch, type BatchResult } from "@/lib/email/dispatch";
import { renderMessage, type RenderedMessage } from "@/lib/email/format";
import {
  EMAIL_MESSAGES,
  archiveTemplate,
  audiencePreview,
  cancelCampaign,
  getCampaign,
  memberNames,
  queueCampaign,
  recordTest,
  saveCampaign,
  saveTemplate,
  searchMembers,
  type Audience,
  type CampaignContent,
  type CampaignDetail,
  type Recipient,
} from "@/lib/email/server";
import { emailConfiguration } from "@/lib/email/transport";

/**
 * Email Centre actions (ADR 0028). Each needs email.send for the signed-in person; the routines
 * check it again, and the worker rechecks the sender before every send.
 */

export type EmailActionState = { code: string; message: string };

const actor = () => requirePermission("email.send");
const message = (code: string) =>
  EMAIL_MESSAGES[code] ?? EMAIL_MESSAGES.SERVER_ERROR;
const UUID_LIST_KEYS = ["committees", "teams", "include", "exclude"] as const;
const TEXT_LIST_KEYS = [
  "categories",
  "institutions",
  "disciplines",
  "interests",
  "statuses",
  "squ",
  "leadership",
] as const;

/** Shape only (the database validates the values): known keys, bounded arrays of the right type. */
export async function cleanAudience(value: unknown): Promise<Audience | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, list] of Object.entries(input)) {
    if (!Array.isArray(list)) return null;
    if ((UUID_LIST_KEYS as readonly string[]).includes(key)) {
      if (list.length > 500 || !list.every(isUuid)) return null;
    } else if ((TEXT_LIST_KEYS as readonly string[]).includes(key)) {
      if (
        list.length > 50 ||
        !list.every((v) => typeof v === "string" && v.length <= 60)
      )
        return null;
    } else if (key === "years") {
      if (!list.every((v) => Number.isInteger(v) && v >= 1 && v <= 7))
        return null;
    } else return null;
    if (list.length) out[key] = [...new Set(list)];
  }
  return out as Audience;
}

async function cleanContent(value: unknown): Promise<CampaignContent | null> {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown, max: number) =>
    x === null || x === undefined || x === ""
      ? null
      : typeof x === "string" && x.length <= max
        ? x
        : undefined;
  const audience = await cleanAudience(v.audience ?? {});
  const content = {
    language: v.language,
    subjectEn: text(v.subjectEn, 200),
    subjectAr: text(v.subjectAr, 200),
    bodyEn: text(v.bodyEn, 20000),
    bodyAr: text(v.bodyAr, 20000),
    audience,
  };
  if (
    (content.language !== "en" &&
      content.language !== "ar" &&
      content.language !== "both") ||
    [content.subjectEn, content.subjectAr, content.bodyEn, content.bodyAr].some(
      (x) => x === undefined
    ) ||
    !audience
  )
    return null;
  return content as CampaignContent;
}

export async function createDraftAction() {
  const who = await actor();
  if (!who) redirect("/admin/communications/email");
  const result = await saveCampaign(who.userId, null, null, {
    language: "en",
    subjectEn: null,
    subjectAr: null,
    bodyEn: null,
    bodyAr: null,
    audience: {},
  });
  if (result.code !== "SUCCESS" || typeof result.id !== "string")
    redirect("/admin/communications/email?error=1");
  redirect(`/admin/communications/email/${result.id}`);
}

export async function saveDraftAction(
  id: string,
  revision: number,
  value: unknown
): Promise<EmailActionState & { revision?: number }> {
  const who = await actor();
  if (!who) return { code: "FORBIDDEN", message: message("FORBIDDEN") };
  const content = await cleanContent(value);
  if (!isUuid(id) || !Number.isSafeInteger(revision) || !content)
    return { code: "VALIDATION_ERROR", message: message("VALIDATION_ERROR") };
  try {
    const result = await saveCampaign(who.userId, id, revision, content);
    if (result.code === "SUCCESS")
      revalidatePath("/admin/communications/email");
    return {
      code: result.code,
      message:
        result.code === "SUCCESS" ? "Draft saved." : message(result.code),
      ...(typeof result.revision === "number"
        ? { revision: result.revision }
        : {}),
    };
  } catch (error) {
    logServerError("email_draft_failed", error);
    return { code: "SERVER_ERROR", message: message("SERVER_ERROR") };
  }
}

export async function previewAudienceAction(
  value: unknown,
  search: string,
  offset: number
): Promise<
  EmailActionState & {
    count?: number;
    matching?: number;
    recipients?: Recipient[];
  }
> {
  const who = await actor();
  if (!who) return { code: "FORBIDDEN", message: message("FORBIDDEN") };
  const audience = await cleanAudience(value);
  if (
    !audience ||
    typeof search !== "string" ||
    search.length > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    return { code: "VALIDATION_ERROR", message: message("VALIDATION_ERROR") };
  try {
    const result = await audiencePreview(
      who.userId,
      audience,
      search.trim() || null,
      offset
    );
    return {
      code: result.code,
      message: message(result.code),
      count: result.count,
      matching: result.matching,
      recipients: result.recipients,
    };
  } catch (error) {
    logServerError("email_audience_failed", error);
    return { code: "SERVER_ERROR", message: message("SERVER_ERROR") };
  }
}

export async function searchMembersAction(query: string) {
  const who = await actor();
  if (!who || typeof query !== "string" || query.length > 100) return [];
  try {
    const result = await searchMembers(who.userId, query);
    return result.members ?? [];
  } catch {
    return [];
  }
}

export async function memberNamesAction(ids: string[]) {
  const who = await actor();
  if (!who || !Array.isArray(ids) || ids.length > 1000 || !ids.every(isUuid))
    return [];
  if (ids.length === 0) return [];
  try {
    return (await memberNames(who.userId, ids)).members ?? [];
  } catch {
    return [];
  }
}

/** The message as a recipient sees it, rendered by the same code that sends it. */
export async function renderPreviewAction(
  value: unknown
): Promise<RenderedMessage | null> {
  const who = await actor();
  const content = await cleanContent(value);
  if (!who || !content) return null;
  return renderMessage(content, {
    name: "Member Name",
    unsubscribeUrl: "https://example.invalid/unsubscribe (preview)",
  });
}

/** A test goes only to the sender's own sign-in address. */
export async function sendTestAction(
  id: string,
  value: unknown
): Promise<EmailActionState> {
  const who = await actor();
  if (!who) return { code: "FORBIDDEN", message: message("FORBIDDEN") };
  const content = await cleanContent(value);
  if (!isUuid(id) || !content)
    return { code: "VALIDATION_ERROR", message: message("VALIDATION_ERROR") };
  const config = emailConfiguration();
  if (!config.sending)
    return { code: "SENDING_DISABLED", message: config.reason };
  if (!who.email)
    return {
      code: "VALIDATION_ERROR",
      message: "Your account has no email address.",
    };
  const rendered = renderMessage(content, {
    name: "Test recipient",
    unsubscribeUrl: null,
  });
  try {
    const outcome = await config.transport.send({
      to: who.email,
      from: config.from,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      headers: {},
      idempotencyKey: `test-${id}-${Date.now()}`,
    });
    await recordTest(
      who.userId,
      id,
      outcome.kind === "accepted" ? "accepted" : "failed"
    );
    return outcome.kind === "accepted"
      ? {
          code: "SUCCESS",
          message: `Test accepted by the email provider for ${who.email}. Acceptance is not proof of delivery; check the inbox.`,
        }
      : {
          code: "SERVER_ERROR",
          message: `The provider refused the test: ${outcome.reason}`,
        };
  } catch (error) {
    logServerError("email_test_failed", error);
    return { code: "SERVER_ERROR", message: message("SERVER_ERROR") };
  }
}

/** Queues a saved draft after the sender confirmed the exact recipient count. */
export async function queueCampaignAction(
  id: string,
  revision: number,
  expected: number
): Promise<EmailActionState & { count?: number }> {
  const who = await actor();
  if (!who) return { code: "FORBIDDEN", message: message("FORBIDDEN") };
  if (
    !isUuid(id) ||
    !Number.isSafeInteger(revision) ||
    !Number.isSafeInteger(expected)
  )
    return { code: "VALIDATION_ERROR", message: message("VALIDATION_ERROR") };
  const config = emailConfiguration();
  if (!config.sending)
    return { code: "SENDING_DISABLED", message: config.reason };
  try {
    const result = await queueCampaign(who.userId, id, revision, expected);
    if (result.code === "SUCCESS") {
      revalidatePath("/admin/communications/email");
      revalidatePath(`/admin/communications/email/${id}`);
    }
    return {
      code: result.code,
      message:
        result.code === "SUCCESS"
          ? `Queued for ${result.recipients} recipients. Sending runs in the background.`
          : message(result.code),
      ...(typeof result.count === "number" ? { count: result.count } : {}),
    };
  } catch (error) {
    logServerError("email_queue_failed", error);
    return { code: "SERVER_ERROR", message: message("SERVER_ERROR") };
  }
}

export async function cancelCampaignAction(
  id: string
): Promise<EmailActionState> {
  const who = await actor();
  if (!who) return { code: "FORBIDDEN", message: message("FORBIDDEN") };
  if (!isUuid(id))
    return { code: "VALIDATION_ERROR", message: message("VALIDATION_ERROR") };
  try {
    const result = await cancelCampaign(who.userId, id);
    revalidatePath(`/admin/communications/email/${id}`);
    return {
      code: result.code,
      message:
        result.code === "SUCCESS"
          ? "Sending stopped. Messages already accepted by the provider cannot be recalled."
          : message(result.code),
    };
  } catch (error) {
    logServerError("email_cancel_failed", error);
    return { code: "SERVER_ERROR", message: message("SERVER_ERROR") };
  }
}

/**
 * Runs one bounded batch for this campaign and returns its progress. The campaign page calls it
 * repeatedly while sending; each call finishes its batch inside the request.
 */
export async function runBatchAction(
  id: string
): Promise<{ batch: BatchResult | null; detail: CampaignDetail | null }> {
  const who = await actor();
  if (!who || !isUuid(id)) return { batch: null, detail: null };
  let batch: BatchResult | null = null;
  try {
    batch = await dispatchEmailBatch({ campaignId: id });
  } catch (error) {
    logServerError("email_batch_failed", error);
  }
  try {
    const result = await getCampaign(who.userId, id);
    return {
      batch,
      detail:
        result.code === "SUCCESS"
          ? (result as unknown as CampaignDetail)
          : null,
    };
  } catch {
    return { batch, detail: null };
  }
}

export async function saveTemplateAction(
  value: unknown
): Promise<EmailActionState> {
  const who = await actor();
  if (!who) return { code: "FORBIDDEN", message: message("FORBIDDEN") };
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const content = await cleanContent({ ...v, language: "both", audience: {} });
  if (!name || name.length > 120 || !content)
    return {
      code: "VALIDATION_ERROR",
      message: "Give the template a name of up to 120 characters.",
    };
  try {
    const result = await saveTemplate(who.userId, null, null, {
      name,
      subjectEn: content.subjectEn,
      subjectAr: content.subjectAr,
      bodyEn: content.bodyEn,
      bodyAr: content.bodyAr,
    });
    revalidatePath("/admin/communications/email");
    return {
      code: result.code,
      message:
        result.code === "SUCCESS" ? "Template saved." : message(result.code),
    };
  } catch (error) {
    logServerError("email_template_failed", error);
    return { code: "SERVER_ERROR", message: message("SERVER_ERROR") };
  }
}

export async function archiveTemplateAction(
  id: string
): Promise<EmailActionState> {
  const who = await actor();
  if (!who) return { code: "FORBIDDEN", message: message("FORBIDDEN") };
  if (!isUuid(id))
    return { code: "VALIDATION_ERROR", message: message("VALIDATION_ERROR") };
  const result = await archiveTemplate(who.userId, id);
  revalidatePath("/admin/communications/email");
  return {
    code: result.code,
    message:
      result.code === "SUCCESS" ? "Template removed." : message(result.code),
  };
}
