"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleStop } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CampaignDetail } from "@/lib/email/server";
import { cancelCampaignAction, runBatchAction } from "../actions";
import { SKIP_LABELS, when } from "../labels";

const ACTIVE = new Set(["queued", "sending"]);

/**
 * A queued or finished message (ADR 0028). While it is sending and this page is open, the page
 * asks the server for one bounded batch at a time; each batch completes inside its request, and the
 * progress is stored, so closing the page only pauses sending until the next batch (from here or
 * the scheduled dispatch route).
 */
export function CampaignProgress({
  initial,
  sendingEnabled,
  disabledReason,
}: {
  initial: CampaignDetail;
  sendingEnabled: boolean;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [busy, start] = useTransition();
  const running = useRef(false);
  const { campaign, counts, problems } = detail;
  const active = ACTIVE.has(campaign.status);

  useEffect(() => {
    if (!active || !sendingEnabled) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || running.current) return;
      running.current = true;
      try {
        const result = await runBatchAction(campaign.id);
        if (!stopped && result.detail) setDetail(result.detail);
      } finally {
        running.current = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, sendingEnabled, campaign.id]);

  const total = counts.total || campaign.recipientCount || 0;
  const done =
    counts.accepted + counts.delivered + counts.failed + counts.skipped;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const rows: [string, number, string][] = [
    [
      "Waiting",
      counts.pending + counts.sending,
      "Not yet handed to the provider.",
    ],
    [
      "Accepted",
      counts.accepted,
      "Taken by the provider. Not proof of delivery.",
    ],
    [
      "Delivered",
      counts.delivered,
      "Confirmed by the provider's delivery report.",
    ],
    [
      "Failed",
      counts.failed,
      "Refused or undeliverable; see the reasons below.",
    ],
    [
      "Skipped",
      counts.skipped,
      "Left out before sending (unsubscribed, suppressed, no longer eligible or stopped).",
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      {campaign.status === "halted" ? (
        <Alert variant="destructive">
          <AlertTitle>Sending halted</AlertTitle>
          <AlertDescription>
            The person who queued this message no longer has the Email Centre
            permission, so the remaining messages were not sent.
          </AlertDescription>
        </Alert>
      ) : null}
      {active && !sendingEnabled ? (
        <Alert>
          <AlertTitle>Sending is paused</AlertTitle>
          <AlertDescription>{disabledReason}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>
            {total} recipient{total === 1 ? "" : "s"}, each sent an individual
            message.{" "}
            {campaign.completedAt
              ? `Finished ${when(campaign.completedAt)}.`
              : campaign.cancelledAt
                ? `Stopped ${when(campaign.cancelledAt)}.`
                : active
                  ? "Sending in the background."
                  : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            role="progressbar"
            aria-label="Messages processed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <dl className="grid gap-3 sm:grid-cols-5">
            {rows.map(([label, value, hint]) => (
              <div key={label} className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd>
              </div>
            ))}
          </dl>
          {active ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  disabled={busy}
                >
                  <CircleStop aria-hidden="true" data-icon="inline-start" />
                  Stop sending
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Stop sending this message?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Messages not yet handed to the provider are skipped.
                    Messages already accepted cannot be recalled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep sending</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      start(async () => {
                        const result = await cancelCampaignAction(campaign.id);
                        if (result.code === "SUCCESS")
                          toast.success(result.message);
                        else toast.error(result.message);
                        router.refresh();
                      })
                    }
                  >
                    Stop sending
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Failed and skipped</CardTitle>
          <CardDescription>
            The most recent 100. Temporary failures are retried automatically up
            to five times before they are reported here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {problems.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {problems.map((p) => (
                <li
                  key={`${p.email}-${p.at}`}
                  className="flex flex-col px-3 py-2"
                >
                  <span className="font-medium">
                    {p.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {p.email}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.status === "failed"
                      ? `Failed after ${p.attempts} attempt${p.attempts === 1 ? "" : "s"}: ${p.error ?? "no reason given"}`
                      : (SKIP_LABELS[p.skipReason ?? ""] ?? "Skipped")}{" "}
                    · {when(p.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 @3xl/main:grid-cols-2">
          {campaign.language !== "ar" ? (
            <div lang="en">
              <p className="font-medium">{campaign.subjectEn}</p>
              <pre className="mt-2 text-sm whitespace-pre-wrap">
                {campaign.bodyEn}
              </pre>
            </div>
          ) : null}
          {campaign.language !== "en" ? (
            <div lang="ar" dir="rtl">
              <p className="font-medium">{campaign.subjectAr}</p>
              <pre className="mt-2 text-sm whitespace-pre-wrap">
                {campaign.bodyAr}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
