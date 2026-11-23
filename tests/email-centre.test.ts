import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("../lib/email/server", () => ({
  claimDeliveries: state.claim,
  completeDelivery: state.complete,
  unsubscribeDelivery: state.unsubscribe,
}));
vi.mock("@/db", () => ({ db: { execute: vi.fn() } }));

import { contentComplete, renderMessage, safeHref } from "../lib/email/format";
import { dispatchEmailBatch } from "../lib/email/dispatch";
import {
  TestTransport,
  emailConfiguration,
  type EmailConfiguration,
} from "../lib/email/transport";
import {
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "../lib/email/unsubscribe";
import {
  GET as unsubscribePage,
  POST as unsubscribePost,
} from "../app/v1/email/unsubscribe/route";
import { POST as dispatchRoute } from "../app/v1/internal/email-dispatch/route";

const SECRET = "s".repeat(40);
const message = (body: string, language: "en" | "ar" | "both" = "en") => ({
  language,
  subjectEn: "Hello {{name}}",
  subjectAr: "مرحباً {{name}}",
  bodyEn: body,
  bodyAr: "نص **عريض**",
});

describe("Email Centre message format", () => {
  it("escapes everything the author types and never runs HTML", () => {
    const { html, text } = renderMessage(
      message(
        `<script>alert(1)</script> <img src=x onerror=alert(1)> "quotes"`
      ),
      { name: "Sara", unsubscribeUrl: null }
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).toContain("<script>alert(1)</script>");
  });

  it("renders the small formatting language", () => {
    const { html, text } = renderMessage(
      message(
        "# Title\n\nA **bold** and *italic* line\nnext line\n\n- one\n- two\n\n1. first\n2. second\n\n[Site](https://example.org/a?b=1&c=2)"
      ),
      { name: "Sara", unsubscribeUrl: null }
    );
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("line<br>next line");
    expect(html).toMatch(/<ul[^>]*><li[^>]*>one<\/li><li[^>]*>two<\/li><\/ul>/);
    expect(html).toMatch(/<ol/);
    expect(html).toContain('href="https://example.org/a?b=1&amp;c=2"');
    expect(text).toContain("TITLE");
    expect(text).toContain("Site (https://example.org/a?b=1&c=2)");
  });

  it("accepts only https and mailto links", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("http://example.org")).toBeNull();
    expect(safeHref("https://user:pass@example.org")).toBeNull();
    expect(safeHref("mailto:office@example.org")).toBe(
      "mailto:office@example.org"
    );
    const { html } = renderMessage(message("[x](javascript:alert(1))"), {
      name: "S",
      unsubscribeUrl: null,
    });
    expect(html).not.toContain('href="javascript');
  });

  it("personalizes, writes Arabic right to left, and adds the unsubscribe footer", () => {
    const { subject, html, text } = renderMessage(
      message("Hi {{ name }}", "both"),
      {
        name: "Sara <b>",
        unsubscribeUrl: "https://core.example/v1/email/unsubscribe?token=abc",
      }
    );
    expect(subject).toBe("Hello Sara <b> | مرحباً Sara <b>");
    expect(html).toContain("Hi Sara &lt;b&gt;");
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain(
      "https://core.example/v1/email/unsubscribe?token=abc"
    );
    expect(text).toContain("Unsubscribe from announcements");
    expect(text).toContain("لإلغاء الاشتراك");
  });

  it("knows when a message has what its language needs", () => {
    expect(contentComplete({ ...message("x"), language: "en" })).toBe(true);
    expect(
      contentComplete({ ...message("x"), language: "both", subjectAr: "" })
    ).toBe(false);
    expect(
      contentComplete({ ...message("x"), language: "ar", bodyAr: " " })
    ).toBe(false);
  });
});

describe("unsubscribe links", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("signs and verifies a delivery id, and rejects forgeries", () => {
    const token = unsubscribeToken(id, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe(id);
    expect(verifyUnsubscribeToken(token, "x".repeat(40))).toBeNull();
    expect(
      verifyUnsubscribeToken(
        `22222222-2222-4222-8222-222222222222.${token.split(".")[1]}`,
        SECRET
      )
    ).toBeNull();
    expect(verifyUnsubscribeToken("not-a-token", SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(token, undefined)).toBeNull();
  });

  it("shows a confirmation on GET and unsubscribes only on POST", async () => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
    state.unsubscribe.mockReset().mockResolvedValue({ code: "SUCCESS" });
    const url = `https://core.example/v1/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(id, SECRET))}`;
    const page = await unsubscribePage(new Request(url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Unsubscribe from announcements?");
    expect(state.unsubscribe).not.toHaveBeenCalled();
    const done = await unsubscribePost(
      new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" })
    );
    expect(done.status).toBe(200);
    expect(state.unsubscribe).toHaveBeenCalledWith(id);
    const forged = await unsubscribePost(
      new Request("https://core.example/v1/email/unsubscribe?token=bad", {
        method: "POST",
      })
    );
    expect(forged.status).toBe(400);
    vi.unstubAllEnvs();
  });
});

describe("email configuration", () => {
  it("keeps sending off until a transport, a sender and a secret exist", () => {
    const off = emailConfiguration({});
    expect(off.sending).toBe(false);
    expect(!off.sending && off.missing).toEqual([
      "EMAIL_TRANSPORT",
      "EMAIL_FROM",
      "EMAIL_UNSUBSCRIBE_SECRET",
    ]);
    expect(
      emailConfiguration({
        EMAIL_TRANSPORT: "resend",
        EMAIL_FROM: "a@b.c",
        EMAIL_UNSUBSCRIBE_SECRET: SECRET,
      }).sending
    ).toBe(false);
  });

  it("refuses the test adapter in production", () => {
    expect(
      emailConfiguration({
        EMAIL_TRANSPORT: "test",
        EMAIL_FROM: "a@b.c",
        EMAIL_UNSUBSCRIBE_SECRET: SECRET,
        VERCEL_ENV: "production",
      }).sending
    ).toBe(false);
  });
});

describe("one dispatch batch", () => {
  const delivery = (id: string, email: string) => ({
    id,
    campaignId: "c",
    email,
    name: "Member",
    attempt: 1,
    language: "en" as const,
    subjectEn: "News",
    subjectAr: null,
    bodyEn: "Hello {{name}}",
    bodyAr: null,
  });
  let transport: TestTransport;
  let config: EmailConfiguration;
  beforeEach(() => {
    transport = new TestTransport();
    config = {
      sending: true,
      transport,
      from: "Society <office@example.org>",
      unsubscribeSecret: SECRET,
    };
    state.complete.mockReset().mockResolvedValue({ code: "SUCCESS" });
    state.claim.mockReset();
  });

  it("sends individually with the delivery id as idempotency key and records each outcome", async () => {
    state.claim.mockResolvedValue({
      code: "SUCCESS",
      deliveries: [
        delivery("11111111-1111-4111-8111-111111111111", "ok@example.org"),
        delivery(
          "22222222-2222-4222-8222-222222222222",
          "fail-temporary@example.org"
        ),
        delivery("33333333-3333-4333-8333-333333333333", "invalid@example.org"),
      ],
    });
    vi.stubEnv("APP_ORIGIN", "https://core.example");
    const result = await dispatchEmailBatch({ config });
    vi.unstubAllEnvs();
    expect(result).toEqual({
      enabled: true,
      claimed: 3,
      accepted: 1,
      retrying: 1,
      failed: 1,
    });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      to: "ok@example.org",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    expect(transport.sent[0].headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/core\.example\/v1\/email\/unsubscribe\?token=/
    );
    expect(state.complete).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "accepted",
      expect.any(String),
      null,
      false
    );
    expect(state.complete).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "retry",
      null,
      expect.any(String),
      false
    );
    expect(state.complete).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      "failed",
      null,
      expect.any(String),
      true
    );
  });

  it("does nothing while sending is not configured", async () => {
    const result = await dispatchEmailBatch({
      config: { sending: false, reason: "off", missing: [] },
    });
    expect(result).toMatchObject({ enabled: false, claimed: 0 });
    expect(state.claim).not.toHaveBeenCalled();
  });

  it("treats an unexpected transport error as temporary", async () => {
    state.claim.mockResolvedValue({
      code: "SUCCESS",
      deliveries: [
        delivery("44444444-4444-4444-8444-444444444444", "x@example.org"),
      ],
    });
    const broken: EmailConfiguration = {
      ...config,
      sending: true,
      transport: {
        name: "broken",
        send: async () => {
          throw new Error("socket closed");
        },
      },
    } as EmailConfiguration;
    const result = await dispatchEmailBatch({ config: broken });
    expect(result.retrying).toBe(1);
    expect(state.complete).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      "retry",
      null,
      expect.any(String),
      false
    );
  });
});

describe("the dispatch route", () => {
  it("refuses callers without the secret, and runs when it is configured and given", async () => {
    vi.stubEnv("EMAIL_DISPATCH_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    expect(
      (
        await dispatchRoute(
          new Request("https://core.example/v1/internal/email-dispatch", {
            method: "POST",
          })
        )
      ).status
    ).toBe(401);
    vi.stubEnv("EMAIL_DISPATCH_SECRET", SECRET);
    const wrong = await dispatchRoute(
      new Request("https://core.example/v1/internal/email-dispatch", {
        method: "POST",
        headers: { authorization: "Bearer nope" },
      })
    );
    expect(wrong.status).toBe(401);
    vi.stubEnv("EMAIL_TRANSPORT", "");
    const ok = await dispatchRoute(
      new Request("https://core.example/v1/internal/email-dispatch", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
      })
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ enabled: false });
    vi.unstubAllEnvs();
  });
});
