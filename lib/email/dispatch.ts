import "server-only";

import { logServerError } from "@/lib/api/log";
import { renderMessage } from "./format";
import { claimDeliveries, completeDelivery } from "./server";
import { emailConfiguration, type EmailConfiguration } from "./transport";
import { unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

/** One bounded batch: at most this many messages, inside one request. */
export const BATCH_SIZE = 25;
/** A claimed delivery is retried if no outcome is recorded within this many seconds. */
export const LEASE_SECONDS = 120;
/** Stop claiming new work after this long, so a batch always finishes inside its request. */
const TIME_BUDGET_MS = 20_000;

export type BatchResult = {
  enabled: boolean;
  claimed: number;
  accepted: number;
  retrying: number;
  failed: number;
};

/**
 * Sends one bounded batch of due deliveries (ADR 0028). The database rechecks each campaign's
 * sender and each recipient before handing a delivery out; this function renders, sends through
 * the configured transport and records every outcome. It finishes before returning: nothing relies
 * on work continuing after the response. Safe to run concurrently (leases), and safe to repeat.
 */
export async function dispatchEmailBatch(
  options: {
    campaignId?: string | null;
    limit?: number;
    config?: EmailConfiguration;
  } = {}
): Promise<BatchResult> {
  const config = options.config ?? emailConfiguration();
  const result: BatchResult = {
    enabled: config.sending,
    claimed: 0,
    accepted: 0,
    retrying: 0,
    failed: 0,
  };
  if (!config.sending) return result;
  const started = Date.now();
  const claimed = await claimDeliveries(
    Math.min(options.limit ?? BATCH_SIZE, BATCH_SIZE),
    LEASE_SECONDS,
    options.campaignId ?? null
  );
  const deliveries =
    claimed.code === "SUCCESS" ? (claimed.deliveries ?? []) : [];
  result.claimed = deliveries.length;
  for (const delivery of deliveries) {
    // Out of time: leave the rest leased; the lease expires and the next batch takes them.
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const token = unsubscribeToken(delivery.id, config.unsubscribeSecret);
    const link = unsubscribeUrl(token);
    const message = renderMessage(delivery, {
      name: delivery.name,
      unsubscribeUrl: link,
    });
    try {
      const outcome = await config.transport.send({
        to: delivery.email,
        from: config.from,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: link
          ? {
              "List-Unsubscribe": `<${link}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            }
          : {},
        idempotencyKey: delivery.id,
      });
      if (outcome.kind === "accepted") {
        await completeDelivery(
          delivery.id,
          "accepted",
          outcome.providerMessageId,
          null,
          false
        );
        result.accepted += 1;
      } else if (outcome.kind === "temporary") {
        await completeDelivery(
          delivery.id,
          "retry",
          null,
          outcome.reason,
          false
        );
        result.retrying += 1;
      } else {
        await completeDelivery(
          delivery.id,
          "failed",
          null,
          outcome.reason,
          outcome.invalidAddress
        );
        result.failed += 1;
      }
    } catch (error) {
      // An unexpected transport error is treated as temporary; the attempt count bounds retries.
      logServerError("email_delivery_failed", error);
      await completeDelivery(
        delivery.id,
        "retry",
        null,
        "The provider could not be reached.",
        false
      ).catch((completion) =>
        logServerError("email_delivery_outcome_failed", completion)
      );
      result.retrying += 1;
    }
  }
  return result;
}
