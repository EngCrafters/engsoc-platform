import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import setupDatabase from "../tests/db/global-setup";

/**
 * Runs M6 against an isolated PostgreSQL 17 container while keeping the
 * existing Supabase Auth login. The supplied user ID receives a grant only in
 * the disposable local database. No staging database is changed.
 */
async function main() {
  const userId = process.argv.at(-1);
  if (
    !userId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId
    )
  ) {
    throw new Error(
      "Usage: npx tsx scripts/m6-local-review.ts <your account UUID>"
    );
  }
  const port = process.env.M6_REVIEW_PORT ?? "3000";
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("M6_REVIEW_PORT must be a valid TCP port.");
  }

  loadEnvConfig(process.cwd());
  const teardown = await setupDatabase();
  try {
    const adminUrl = process.env.TEST_DATABASE_URL!;
    const runtimeUrl = process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL!;
    if (
      !["127.0.0.1", "localhost"].includes(new URL(adminUrl).hostname) ||
      !["127.0.0.1", "localhost"].includes(new URL(runtimeUrl).hostname)
    ) {
      throw new Error("M6 local review requires loopback database URLs.");
    }
    const sql = postgres(adminUrl, { max: 1, prepare: false });
    try {
      const committeeId = randomUUID();
      await sql`INSERT INTO auth.users (id) VALUES (${userId})`;
      await sql`INSERT INTO public.committees (id, name) VALUES (${committeeId}, 'Events Committee — local review')`;
      await sql`INSERT INTO public.committee_managers (user_id, committee_id, granted_by)
        VALUES (${userId}, ${committeeId}, ${userId})`;

      const start = Date.now();
      const fixtures = [
        {
          title: "Engineering Design Workshop",
          date: new Date(start + 14 * 86_400_000),
          location: "Innovation Lab",
          status: "published",
          capacity: 80,
        },
        {
          title: "Industry Connections Evening",
          date: new Date(start + 21 * 86_400_000),
          location: "Main Hall",
          status: "draft",
          capacity: 120,
        },
        {
          title: "Robotics Challenge",
          date: new Date(start + 28 * 86_400_000),
          location: "Workshop Studio",
          status: "full",
          capacity: 40,
        },
      ] as const;
      for (const event of fixtures) {
        await sql`INSERT INTO public.events
          (title, description, event_date, location, committee_id, status, capacity)
          VALUES (${event.title}, 'Local review event. Safe to edit during visual inspection.', ${event.date}, ${event.location}, ${committeeId}, ${event.status}::public.event_status, ${event.capacity})`;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }

    if (process.env.M6_REVIEW_CHECK_ONLY === "1") {
      const runtime = postgres(runtimeUrl, { max: 1, prepare: false });
      try {
        const rows = await runtime`SELECT id FROM private.list_admin_events(
          ${userId}::uuid, null::uuid, 'all'::text,
          null::timestamptz, null::uuid, 21::integer)`;
        if (rows.length !== 3) {
          throw new Error(
            `Expected 3 local review events, got ${rows.length}.`
          );
        }
        console.log("M6 local review database check passed: 3 scoped events.");
      } finally {
        await runtime.end({ timeout: 5 });
      }
      return;
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APP_RUNTIME_DATABASE_URL: runtimeUrl,
      UC02_LOCAL_REVIEW_DATABASE_URL: adminUrl,
    };
    delete env.VERCEL;
    const nextBin = join(
      process.cwd(),
      "node_modules",
      "next",
      "dist",
      "bin",
      "next"
    );
    const server = spawn(process.execPath, [nextBin, "dev", "-p", port], {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    console.log(`M6 local review: http://localhost:${port}/admin/events`);
    console.log(
      "The event fixtures and manager grant exist only in the disposable local database."
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Next.js exited with code ${code}`))
      );
    });
  } finally {
    await teardown?.();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
