import { afterAll, describe, expect, it } from "vitest";
import { adminDb, close, createFixture, runtimeDb } from "./helpers";

describe("app_runtime database boundary", () => {
  const admin = adminDb();
  const runtime = runtimeDb();

  afterAll(async () => close(admin, runtime));

  it("connects without BYPASSRLS and cannot perform direct table or schema operations", async () => {
    const [{ current_user: currentUser, rolbypassrls }] = await runtime<
      { current_user: string; rolbypassrls: boolean }[]
    >`SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(currentUser).toBe("app_runtime");
    expect(rolbypassrls).toBe(false);

    await expect(runtime`SELECT * FROM public.events`).rejects.toMatchObject({
      code: "42501",
    });
    for (const table of [
      "archive_items",
      "certificates",
      "committee_managers",
      "committees",
      "events",
      "members",
      "mentorship_connections",
      "registration_attempts",
      "registrations",
      "private.uc02_audit",
    ]) {
      await expect(
        runtime.unsafe(`SELECT * FROM ${table}`)
      ).rejects.toMatchObject({
        code: "42501",
      });
    }
    await expect(
      runtime`INSERT INTO public.events (title, event_date, committee_id) VALUES ('Denied', now(), gen_random_uuid())`
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime`UPDATE public.events SET title = 'Denied' WHERE false`
    ).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      runtime`DELETE FROM public.events WHERE false`
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime.unsafe("CREATE TABLE private.runtime_probe (id integer)")
    ).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("can execute an approved routine but not an unapproved private routine", async () => {
    const fixture = await createFixture(admin, { status: "published" });
    const result = await runtime<
      [{ result: { code: string } }]
    >`SELECT private.register_for_event(${fixture.eventId}, 'Runtime attendee', 'runtime@example.test', 'register', '198.51.100.91'::inet) AS result`;
    expect(result[0].result.code).toBe("SUCCESS");

    await expect(
      runtime`SELECT private.unapproved_probe()`
    ).rejects.toMatchObject({ code: "42501" });
  });
});
