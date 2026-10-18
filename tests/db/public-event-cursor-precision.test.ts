import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { adminDb, close, runtimeDb } from "./helpers";

const state = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute: state.execute } }));
const { getPublicEventPage } = await import("@/lib/events");

describe("public event cursor PostgreSQL timestamp precision", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  const client = drizzle(runtime);
  beforeAll(() => {
    state.execute.mockImplementation((query) => client.execute(query));
  });
  afterAll(async () => close(admin, runtime));

  it.each(["upcoming", "past"] as const)(
    "pages %s submillisecond timestamp ties without repeats or omissions",
    async (period) => {
      const committee = randomUUID();
      const prefix = randomUUID().slice(0, 8);
      const ids = Array.from(
        { length: 25 },
        (_, index) =>
          `${prefix}-1111-4111-8111-${index.toString().padStart(12, "0")}`
      );
      const date =
        new Date(Date.now() + (period === "upcoming" ? 300000 : -1000))
          .toISOString()
          .slice(0, 19) + ".123456Z";
      await admin`INSERT INTO public.committees (id,name) VALUES (${committee},${`Precision ${committee}`});`;
      try {
        for (const id of ids) {
          await admin`INSERT INTO public.events (id,title,description,event_date,committee_id,status)
          VALUES (${id}, 'Precision fixture', 'Synthetic cursor fixture', date_trunc('second', ${date}::timestamptz) + interval '0.123456 seconds', ${committee}, 'published');`;
        }
        state.execute.mockClear();
        const seen = new Set<string>();
        const collected: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await getPublicEventPage({ period, cursor });
          for (const event of page.events) {
            expect(seen.has(event.id), "cursor repeated an event").toBe(false);
            seen.add(event.id);
            if (ids.includes(event.id)) {
              collected.push(event.id);
              expect(event.eventDate.getMilliseconds()).toBe(123);
              expect(event).not.toHaveProperty("cursorDate");
            }
          }
          if (
            page.nextCursor &&
            page.events.some((event) => ids.includes(event.id))
          ) {
            const payload = JSON.parse(
              Buffer.from(page.nextCursor, "base64url").toString("utf8")
            );
            expect(payload.date).toContain(".123456");
          }
          cursor = page.nextCursor ?? undefined;
          expect(++pages).toBeLessThan(100);
        } while (cursor);
        expect(collected).toEqual(
          period === "upcoming" ? ids : ids.toReversed()
        );
        expect(state.execute).toHaveBeenCalledTimes(pages);
      } finally {
        await admin`DELETE FROM public.events WHERE committee_id=${committee};`;
        await admin`DELETE FROM public.committees WHERE id=${committee};`;
      }
    }
  );
});
