import type { CampaignStatus } from "@/lib/email/server";

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  sending: "Sending",
  completed: "Finished",
  cancelled: "Stopped",
  halted: "Halted",
};

export const SKIP_LABELS: Record<string, string> = {
  unsubscribed: "Unsubscribed before sending",
  suppressed: "Address suppressed",
  not_eligible: "No longer an eligible member",
  sender_not_authorized: "Sender lost the Email Centre permission",
  cancelled: "Sending was stopped",
};

export const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "Asia/Muscat",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
