import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ErrorState } from "@/components/admin/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isUuid, requirePermission } from "@/lib/administration/access";
import { logServerError } from "@/lib/api/log";
import {
  filterOptions,
  getCampaign,
  listTemplates,
  memberNames,
  type CampaignDetail,
} from "@/lib/email/server";
import { emailConfiguration } from "@/lib/email/transport";
import { STATUS_LABELS } from "../labels";
import type { TemplateRow } from "../template-list";
import { Composer, type FilterOptions } from "./composer";
import { CampaignProgress } from "./campaign-progress";

export const dynamic = "force-dynamic";

export default async function EmailMessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, actor] = await Promise.all([
    params,
    requirePermission("email.send"),
  ]);
  if (!actor)
    return (
      <ErrorState
        title="The Email Centre needs the Email Centre permission"
        description="It is assigned explicitly under Administration → Permissions."
      />
    );
  if (!isUuid(id)) notFound();
  const config = emailConfiguration();
  let detail: CampaignDetail | null = null;
  let options: FilterOptions | null = null;
  let templates: TemplateRow[] = [];
  let names: { id: string; name: string; email: string }[] = [];
  try {
    const result = await getCampaign(actor.userId, id);
    if (result.code === "NOT_FOUND") notFound();
    if (result.code === "SUCCESS") detail = result as unknown as CampaignDetail;
    if (detail?.campaign.status === "draft") {
      const audience = detail.campaign.audience;
      const ids = [...(audience.include ?? []), ...(audience.exclude ?? [])];
      const [opts, saved, named] = await Promise.all([
        filterOptions(actor.userId),
        listTemplates(actor.userId),
        ids.length ? memberNames(actor.userId, ids) : Promise.resolve(null),
      ]);
      if (opts.code === "SUCCESS") options = opts as unknown as FilterOptions;
      if (saved.code === "SUCCESS")
        templates = saved.templates as TemplateRow[];
      names = named?.members ?? [];
    }
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    logServerError("email_message_failed", error);
  }
  if (!detail || (detail.campaign.status === "draft" && !options))
    return (
      <ErrorState
        title="This message is unavailable"
        description="It could not be loaded. Try again shortly."
      />
    );
  const { campaign } = detail;
  const subject =
    campaign.subjectEn || campaign.subjectAr || "Untitled message";

  return (
    <section
      aria-labelledby="email-message-title"
      className="flex flex-col gap-6"
    >
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/communications/email">
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Email Centre
          </Link>
        </Button>
      </div>
      <AdminPageHeader
        headingId="email-message-title"
        title={campaign.status === "draft" ? "Write a message" : subject}
        description={
          campaign.status === "draft"
            ? "Choose who receives it, write it in English, Arabic or both, preview it, send yourself a test, then confirm the exact recipient count."
            : `Queued ${campaign.queuedAt ? new Date(campaign.queuedAt).toLocaleString("en-GB", { timeZone: "Asia/Muscat" }) : ""}${campaign.queuedByEmail ? ` by ${campaign.queuedByEmail}` : ""}.`
        }
        context={
          <Badge variant="outline">{STATUS_LABELS[campaign.status]}</Badge>
        }
      />
      {campaign.status === "draft" ? (
        <Composer
          campaign={campaign}
          options={options!}
          templates={templates}
          initialNames={names}
          sending={
            config.sending
              ? { enabled: true, reason: null }
              : { enabled: false, reason: config.reason }
          }
          actorEmail={actor.email}
        />
      ) : (
        <CampaignProgress
          initial={detail}
          sendingEnabled={config.sending}
          disabledReason={config.sending ? null : config.reason}
        />
      )}
    </section>
  );
}
