import "server-only";

import { appendFile } from "node:fs/promises";

/**
 * The Email Centre's delivery boundary (ADR 0028). The provider is deferred by the owner, so the
 * only adapter is the test adapter; a provider adapter implements `EmailTransport` and is selected
 * here once chosen. Credentials stay on the server.
 */

export type OutgoingEmail = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  /** The delivery id: a provider must treat a repeat with the same key as the same message. */
  idempotencyKey: string;
};

export type SendOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "temporary"; reason: string }
  | { kind: "permanent"; reason: string; invalidAddress: boolean };

export interface EmailTransport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendOutcome>;
}

export type EmailConfiguration =
  | {
      sending: true;
      transport: EmailTransport;
      from: string;
      unsubscribeSecret: string;
    }
  | {
      sending: false;
      /** Why sending is off, in words the page shows. */
      reason: string;
      missing: string[];
    };

const isProduction = (env: Record<string, string | undefined>) =>
  env.VERCEL_ENV === "production" ||
  (env.NODE_ENV === "production" && Boolean(env.VERCEL));

/**
 * A recording adapter for tests and local review. It never contacts a provider. Addresses whose
 * local part is `fail-temporary` or `fail-permanent` (and `invalid`) simulate provider answers, so
 * retries and failure reporting can be tested. With EMAIL_TEST_OUTBOX set, each accepted message
 * is appended to that file as one JSON line.
 */
export class TestTransport implements EmailTransport {
  readonly name = "test";
  readonly sent: OutgoingEmail[] = [];
  constructor(private readonly outbox?: string) {}
  async send(email: OutgoingEmail): Promise<SendOutcome> {
    const local = email.to.split("@")[0];
    if (local.startsWith("fail-temporary"))
      return { kind: "temporary", reason: "Simulated temporary failure" };
    if (local.startsWith("fail-permanent") || local.startsWith("invalid"))
      return {
        kind: "permanent",
        reason: "Simulated rejected address",
        invalidAddress: true,
      };
    this.sent.push(email);
    if (this.outbox)
      await appendFile(
        this.outbox,
        `${JSON.stringify({ ...email, sentAt: new Date().toISOString() })}\n`
      );
    return {
      kind: "accepted",
      providerMessageId: `test-${email.idempotencyKey}`,
    };
  }
}

let testTransport: TestTransport | null = null;

/** The configured transport, or why sending is disabled. Reads server configuration only. */
export function emailConfiguration(
  env: Record<string, string | undefined> = process.env
): EmailConfiguration {
  const missing: string[] = [];
  const name = env.EMAIL_TRANSPORT?.trim() || "";
  const from = env.EMAIL_FROM?.trim() || "";
  const secret = env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || "";
  if (!name) missing.push("EMAIL_TRANSPORT");
  if (!from) missing.push("EMAIL_FROM");
  if (secret.length < 32) missing.push("EMAIL_UNSUBSCRIBE_SECRET");
  if (name && name !== "test")
    return {
      sending: false,
      reason: `No adapter exists for the email provider "${name}". The provider choice is deferred; add its adapter in lib/email/transport.ts.`,
      missing: ["EMAIL_TRANSPORT"],
    };
  if (name === "test" && isProduction(env))
    return {
      sending: false,
      reason: "The test adapter is refused in production.",
      missing: ["EMAIL_TRANSPORT"],
    };
  if (missing.length)
    return {
      sending: false,
      reason:
        "Sending is not configured yet: the sender address and email provider are still to be chosen. Drafts, audiences and previews work; sending stays off.",
      missing,
    };
  testTransport ??= new TestTransport(
    env.EMAIL_TEST_OUTBOX?.trim() || undefined
  );
  return {
    sending: true,
    transport: testTransport,
    from,
    unsubscribeSecret: secret,
  };
}
