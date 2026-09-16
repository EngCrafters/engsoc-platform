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
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
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
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = "app_runtime";
  runtimeUrl.password = runtimePassword;
  process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL = runtimeUrl.toString();

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
