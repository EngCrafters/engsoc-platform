import { spawn } from "node:child_process";
import { join } from "node:path";
import postgres from "postgres";
import databaseSetup from "../db/global-setup";
import {
  E2E_COMMITTEE,
  E2E_EVENTS,
  E2E_WAITLIST_FILLER_EMAIL,
} from "./fixtures";

async function waitForServer(url: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* server is booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("E2E Next.js server did not become ready.");
}

function runToCompletion(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`next build exited with code ${code}`))
    );
  });
}

export default async function globalSetup() {
  const teardownDatabase = await databaseSetup();
  const admin = postgres(process.env.TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    await admin`INSERT INTO public.committees (id, name) VALUES (${E2E_COMMITTEE}, 'E2E Committee')`;
    const now = Date.now();
    const upcoming = new Date(now + 86_400_000).toISOString();
    const past = new Date(now - 86_400_000).toISOString();
    const rows = [
      [E2E_EVENTS.open, "Open E2E event", upcoming, "published"],
      [E2E_EVENTS.full, "Full E2E event", upcoming, "full"],
      [E2E_EVENTS.past, "Past E2E event", past, "published"],
      [E2E_EVENTS.draft, "Draft E2E event", upcoming, "draft"],
      [E2E_EVENTS.waitlist, "Waitlist E2E event", upcoming, "published"],
      ...Array.from({ length: 21 }, (_, index) => [
        `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        `Paged E2E event ${String(index + 1).padStart(2, "0")}`,
        new Date(now + (index + 2) * 86_400_000).toISOString(),
        "published",
      ]),
    ];
    for (const [id, title, eventDate, status] of rows) {
      await admin`INSERT INTO public.events (id, title, description, event_date, location, committee_id, status)
        VALUES (${id}, ${title}, 'E2E event description.', ${eventDate}::timestamptz, 'E2E Hall', ${E2E_COMMITTEE}, ${status}::public.event_status)`;
    }
    // Capacity 1, seat already filled by a confirmed registration — proves
    // numerically-derived "waitlist" availability, distinct from the
    // manually-held `full` fixture above.
    await admin`UPDATE public.events SET capacity = 1 WHERE id = ${E2E_EVENTS.waitlist}`;
    await admin`INSERT INTO public.registrations (event_id, attendee_name, attendee_email, status)
      VALUES (${E2E_EVENTS.waitlist}, 'Filler', ${E2E_WAITLIST_FILLER_EMAIL}, 'confirmed')`;
  } finally {
    await admin.end({ timeout: 5 });
  }

  // Run against a production build, not `next dev`: dev-mode Turbopack
  // relies on an HMR WebSocket for its streaming/Suspense swap, and that
  // connection is unreliable in this environment, leaving the resolved
  // page inert behind the stale loading fallback. A production build has
  // no such dependency and matches what Vercel actually serves.
  const nextBin = join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );
  await runToCompletion([nextBin, "build"], {
    ...process.env,
    // A clean CI runner has no .env.local. The build evaluates server modules,
    // so it needs the same disposable restricted role as the started app.
    APP_RUNTIME_DATABASE_URL: process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL!,
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder",
  });

  const child = spawn(process.execPath, [nextBin, "start", "-p", "3100"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_RUNTIME_DATABASE_URL: process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL!,
    },
    stdio: "ignore",
  });
  await waitForServer("http://127.0.0.1:3100/");
  return async () => {
    child.kill();
    await teardownDatabase?.();
  };
}
