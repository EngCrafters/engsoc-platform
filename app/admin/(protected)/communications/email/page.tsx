import Link from "next/link";
import { Mail, MailPlus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { ErrorState } from "@/components/admin/error-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/lib/administration/access";
import { logServerError } from "@/lib/api/log";
import {
  listCampaigns,
  listTemplates,
  type CampaignStatus,
  type DeliveryCounts,
} from "@/lib/email/server";
import { emailConfiguration } from "@/lib/email/transport";
import { createDraftAction } from "./actions";
import { STATUS_LABELS, when } from "./labels";
import { TemplateList, type TemplateRow } from "./template-list";

export const dynamic = "force-dynamic";

type CampaignRow = {
  id: string;
  status: CampaignStatus;
  subject: string | null;
  createdAt: string;
  createdByEmail: string | null;
  queuedAt: string | null;
  recipientCount: number | null;
  counts: DeliveryCounts | null;
  haltReason: string | null;
};

/**
 * Communications → Email Centre (ADR 0028): messages to eligible members across all committees and
 * teams, for holders of the Email Centre permission.
 */
export default async function EmailCentrePage() {
  const actor = await requirePermission("email.send");
  if (!actor)
    return (
      <ErrorState
        title="The Email Centre needs the Email Centre permission"
        description="It is assigned explicitly under Administration → Permissions."
      />
    );
  const config = emailConfiguration();
  let campaigns: CampaignRow[] | null = null;
  let templates: TemplateRow[] = [];
  try {
    const [list, saved] = await Promise.all([
      listCampaigns(actor.userId, 0),
      listTemplates(actor.userId),
    ]);
    if (list.code === "SUCCESS") campaigns = list.campaigns as CampaignRow[];
    if (saved.code === "SUCCESS") templates = saved.templates as TemplateRow[];
  } catch (error) {
    logServerError("email_centre_failed", error);
  }
  if (!campaigns)
    return (
      <ErrorState
        title="The Email Centre is unavailable"
        description="Its messages could not be loaded. Migration 0036 is required."
      />
    );

  return (
    <section aria-labelledby="email-title" className="flex flex-col gap-6">
      <AdminPageHeader
        headingId="email-title"
        title="Email Centre"
        description="Write to eligible members across all committees and teams. Each member receives an individual message; unsubscribed and suppressed addresses are always left out."
        actions={
          <form action={createDraftAction}>
            <Button type="submit">
              <MailPlus aria-hidden="true" data-icon="inline-start" />
              New message
            </Button>
          </form>
        }
      />
      {config.sending ? null : (
        <Alert>
          <Mail aria-hidden="true" />
          <AlertTitle>Sending is turned off</AlertTitle>
          <AlertDescription>
            {config.reason} Missing configuration: {config.missing.join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Messages</CardTitle>
          <CardDescription>
            Drafts and sent messages, newest first. Accepted means the provider
            took the message; it is not proof of delivery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No messages yet"
              description="Start a new message to choose an audience and write it in English, Arabic or both."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table className="min-w-[44rem]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="text-right">Accepted</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-72">
                        <Link
                          href={`/admin/communications/email/${c.id}`}
                          className="block truncate font-medium underline-offset-4 hover:underline"
                          dir="auto"
                        >
                          {c.subject || "Untitled message"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            c.status === "halted"
                              ? "destructive"
                              : c.status === "draft"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {STATUS_LABELS[c.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.recipientCount ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.counts
                          ? c.counts.accepted + c.counts.delivered
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.counts ? c.counts.failed : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {when(c.createdAt)}
                        {c.createdByEmail ? ` · ${c.createdByEmail}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            Reusable subjects and messages. Load one into a draft from the
            message editor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateList templates={templates} />
        </CardContent>
      </Card>
    </section>
  );
}
