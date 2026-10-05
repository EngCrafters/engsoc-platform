import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import postgres from "postgres";

const TEST_DATABASE_NAME = "uc02_test";
type DockerContainer = { name: string; port: string };

function run(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${code}): ${stderr.trim()}`
          )
        );
    });
    child.stdin.end(input);
  });
}

function assertSafeTestUrl(value: string) {
  const url = new URL(value);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (
    !localHosts.has(url.hostname) ||
    !url.pathname.toLowerCase().includes("uc02_test")
  ) {
    throw new Error(
      "TEST_DATABASE_URL must target a local database named uc02_test."
    );
  }
}

async function startDocker(): Promise<DockerContainer> {
  await run("docker", ["version", "--format", "{{.Server.Version}}"]).catch(
    () => {
      throw new Error(
        "PostgreSQL 17 is required for database tests. Start Docker Desktop or set a safe local TEST_DATABASE_URL."
      );
    }
  );

  const name = `engsoc-uc02-test-${randomUUID()}`;
  const id = await run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--env",
    "POSTGRES_PASSWORD=postgres",
    "--env",
    `POSTGRES_DB=${TEST_DATABASE_NAME}`,
    "--publish",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  ]);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const port = await run("docker", ["port", name, "5432/tcp"]);
      if (port) {
        const exposedPort = port.split(":").at(-1)!;
        const probe = postgres(
          `postgres://postgres:postgres@127.0.0.1:${exposedPort}/${TEST_DATABASE_NAME}`,
          {
            max: 1,
            prepare: false,
            connect_timeout: 1,
          }
        );
        try {
          await probe`SELECT 1`;
          return { name, port: exposedPort };
        } finally {
          await probe.end({ timeout: 1 }).catch(() => undefined);
        }
      }
    } catch {
      // Docker can publish the port before PostgreSQL accepts connections.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await run("docker", ["rm", "--force", id]).catch(() => undefined);
  throw new Error("PostgreSQL 17 test container did not expose a port.");
}

async function applyMigrations(
  databaseUrl: string,
  runtimePassword: string,
  maintenancePassword: string
) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql.unsafe(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text UNIQUE,
        email_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        last_sign_in_at timestamptz, invited_at timestamptz);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
    `);

    const migrationDirectory = join(process.cwd(), "db", "migrations");
    const migrations = (await readdir(migrationDirectory))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    for (const migration of migrations) {
      if (migration === "0016_application_access_hierarchy.sql") {
        const legacyId = randomUUID();
        const legacyManager = randomUUID();
        const arabicId = randomUUID();
        const arabicEvent = randomUUID();
        const arabicRegistration = randomUUID();
        const legacyEvent = randomUUID();
        const legacyRegistration = randomUUID();
        process.env.UC02_TEST_LEGACY_COMMITTEE_ID = legacyId;
        process.env.UC02_TEST_LEGACY_MANAGER_ID = legacyManager;
        process.env.UC02_TEST_ARABIC_RELATIONS_ID = arabicId;
        process.env.UC02_TEST_ARABIC_EVENT_ID = arabicEvent;
        process.env.UC02_TEST_ARABIC_REGISTRATION_ID = arabicRegistration;
        process.env.UC02_TEST_LEGACY_EVENT_ID = legacyEvent;
        process.env.UC02_TEST_LEGACY_REGISTRATION_ID = legacyRegistration;
        await sql`INSERT INTO auth.users (id, email) VALUES
          (${legacyManager}, 'legacy-events@example.test')`;
        await sql`INSERT INTO public.committees (id, name) VALUES
          (${legacyId}, 'Events'), (${arabicId}, 'لجنة العلاقات')`;
        await sql`INSERT INTO public.committee_managers
          (user_id, committee_id, granted_by)
          VALUES (${legacyManager}, ${legacyId}, ${legacyManager})`;
        await sql`INSERT INTO public.events
          (id, title, description, event_date, committee_id, status, archived_at)
          VALUES (${legacyEvent}, 'M8 release smoke fixture', 'Disposable rehearsal data',
            now() + interval '7 days', ${legacyId}, 'draft', now())`;
        await sql`INSERT INTO public.registrations
          (id, event_id, attendee_name, attendee_email, status)
          VALUES (${legacyRegistration}, ${legacyEvent}, 'Smoke fixture',
            'smoke@example.test', 'confirmed')`;
        await sql`INSERT INTO public.events
          (id, title, description, event_date, committee_id, status)
          VALUES (${arabicEvent}, 'Historical Relations event', 'Preserved relationship',
            now() + interval '30 days', ${arabicId}, 'draft')`;
        await sql`INSERT INTO public.registrations
          (id, event_id, attendee_name, attendee_email, status)
          VALUES (${arabicRegistration}, ${arabicEvent}, 'History fixture',
            'history@example.test', 'confirmed')`;
        await sql`INSERT INTO private.uc02_audit
          (committee_id, event_id, actor_kind, action, changes)
          VALUES (${legacyId}, ${legacyEvent}, 'migration', 'history.imported', '{}')`;
      }
      await sql.unsafe(
        await readFile(join(migrationDirectory, migration), "utf8")
      );
    }

    await sql.unsafe(`
      ALTER ROLE app_runtime PASSWORD '${runtimePassword}';
      ALTER ROLE app_maintenance PASSWORD '${maintenancePassword}';
      CREATE OR REPLACE FUNCTION private.unapproved_probe() RETURNS text
      LANGUAGE sql SECURITY DEFINER SET search_path = pg_temp AS $$ SELECT 'nope' $$;
      REVOKE ALL ON FUNCTION private.unapproved_probe() FROM PUBLIC;
    `);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default async function setup() {
  let container: DockerContainer | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl) {
    assertSafeTestUrl(databaseUrl);
  } else {
    container = await startDocker();
    databaseUrl = `postgres://postgres:postgres@127.0.0.1:${container.port}/${TEST_DATABASE_NAME}`;
  }

  const runtimePassword = randomUUID();
  const maintenancePassword = randomUUID();
  process.env.TEST_DATABASE_URL = databaseUrl;
  if (container) process.env.UC02_TEST_CONTAINER_NAME = container.name;
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = "app_runtime";
  runtimeUrl.password = runtimePassword;
  process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL = runtimeUrl.toString();
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.username = "app_maintenance";
  maintenanceUrl.password = maintenancePassword;
  process.env.UC02_TEST_APP_MAINTENANCE_DATABASE_URL =
    maintenanceUrl.toString();

  if (
    !existsSync(
      join(process.cwd(), "db", "migrations", "0000_initial_schema.sql")
    )
  ) {
    throw new Error("UC-02 test harness must run from the repository root.");
  }
  await applyMigrations(databaseUrl, runtimePassword, maintenancePassword);

  return async () => {
    if (container)
      await run("docker", ["rm", "--force", container.name]).catch(
        () => undefined
      );
  };
}
