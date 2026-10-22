import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import setupDatabase from "../db/global-setup";

// These adapters exist only in this isolated test harness. Core's real auth
// verification calls them over HTTP; all business logic uses real app_runtime SQL.
// Accounts created through the website's sign-up join this list, unconfirmed until
// their emailed link is used; the synthetic inbox below holds those links.
type Person = {
  id: string;
  email: string;
  name: string;
  role: string;
  committee?: string;
  password?: string;
  confirmed?: boolean;
};
const identities: Person[] = [
  {
    id: "91000000-0000-4000-8000-000000000001",
    email: "event-manager@example.test",
    name: "Synthetic Manager",
    role: "COMMITTEE_MANAGER",
    committee: "media",
  },
  {
    id: "91000000-0000-4000-8000-000000000002",
    email: "event-member@example.test",
    name: "Synthetic Member",
    role: "member",
  },
  {
    id: "91000000-0000-4000-8000-000000000003",
    email: "other-manager@example.test",
    name: "Unrelated Manager",
    role: "COMMITTEE_MANAGER",
    committee: "finance",
  },
  {
    id: "91000000-0000-4000-8000-000000000004",
    email: "waitlist-member@example.test",
    name: "Synthetic Waitlist Member",
    role: "member",
  },
  {
    id: "91000000-0000-4000-8000-000000000005",
    email: "project-reviewer@example.test",
    name: "Synthetic Society Affairs Reviewer",
    role: "COMMITTEE_MANAGER",
    committee: "society-affairs",
  },
  // ADR 0024: senior administrators and an account the administration flow erases.
  {
    id: "91000000-0000-4000-8000-000000000006",
    email: "board-admin@example.test",
    name: "Synthetic Board Administrator",
    role: "BOARD_ADMIN",
  },
  {
    id: "91000000-0000-4000-8000-000000000007",
    email: "technical-admin@example.test",
    name: "Synthetic Technical Owner",
    role: "TECHNICAL",
  },
  {
    id: "91000000-0000-4000-8000-000000000008",
    email: "erase-member@example.test",
    name: "Synthetic Erasure Member",
    role: "member",
  },
];
const serviceKey = "synthetic-service-role-key-for-local-tests";
const password = "Synthetic-test-password-42!";
const anon = "synthetic-public-anon-key-for-local-tests";

export default async function setup() {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      "Set a fresh safe local TEST_DATABASE_URL; hosted databases are forbidden."
    );
  const teardownDb = await setupDatabase();
  const db = postgres(process.env.TEST_DATABASE_URL, {
    prepare: false,
    max: 2,
  });
  const jwtSecret = randomBytes(32);
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  const inbox: {
    to: string;
    type: string;
    link?: string;
    newEmail?: string;
  }[] = [];
  const links = new Map<string, string>();
  let failNextCover = false;
  const session = (person: Person) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        sub: person.id,
        email: person.email,
        role: "authenticated",
        aud: "authenticated",
        iat: now,
        exp: now + 7200,
      })
    ).toString("base64url");
    const signature = createHmac("sha256", jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return {
      access_token: `${header}.${body}.${signature}`,
      refresh_token: `synthetic-${person.id}`,
      token_type: "bearer",
      expires_in: 7200,
      expires_at: now + 7200,
      user: user(person),
    };
  };
  const user = (person: Person) => ({
    id: person.id,
    email: person.email,
    email_confirmed_at:
      person.confirmed === false ? null : new Date().toISOString(),
    confirmed_at: person.confirmed === false ? null : new Date().toISOString(),
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
  });
  const verified = (req: IncomingMessage) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer /i, "") ?? "";
      const [header, body, signature] = token.split(".");
      if (
        createHmac("sha256", jwtSecret)
          .update(`${header}.${body}`)
          .digest("base64url") !== signature
      )
        return null;
      const claims = JSON.parse(Buffer.from(body, "base64url").toString());
      if (claims.exp <= Date.now() / 1000) return null;
      return identities.find((p) => p.id === claims.sub) ?? null;
    } catch {
      return null;
    }
  };
  const json = (res: ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const stub = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (
      origin &&
      ["http://127.0.0.1:3600", "http://127.0.0.1:3601"].includes(origin)
    )
      res.setHeader("access-control-allow-origin", origin);
    res.setHeader(
      "access-control-allow-headers",
      req.headers["access-control-request-headers"] ??
        "authorization,apikey,content-type,x-client-info"
    );
    res.setHeader(
      "access-control-allow-methods",
      "GET,POST,PUT,DELETE,OPTIONS"
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url!, "http://127.0.0.1:3602");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    try {
      if (
        url.pathname === "/__test__/fail-next-cover" &&
        req.method === "POST"
      ) {
        failNextCover = true;
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === "/__test__/inbox") {
        json(res, inbox);
        return;
      }
      if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
        const body = JSON.parse(bytes.toString());
        const email = String(body.email).toLowerCase();
        let person = identities.find((p) => p.email === email);
        if (!person) {
          person = {
            id: randomUUID(),
            email,
            name: "",
            role: "registrant",
            password: String(body.password),
            confirmed: false,
          };
          identities.push(person);
          await db`INSERT INTO auth.users(id,email) VALUES(${person.id},${email})`;
          const token = randomBytes(24).toString("hex");
          links.set(token, person.id);
          const redirect =
            url.searchParams.get("redirect_to") ??
            "http://127.0.0.1:3601/login";
          inbox.push({
            to: email,
            type: "signup",
            link: `${redirect}?token_hash=${token}&type=signup`,
          });
        }
        json(res, {
          ...user(person),
          confirmation_sent_at: new Date().toISOString(),
        });
        return;
      }
      if (url.pathname === "/auth/v1/verify" && req.method === "POST") {
        const body = JSON.parse(bytes.toString());
        const person = identities.find(
          (p) => p.id === links.get(String(body.token_hash))
        );
        if (!person || body.type !== "signup") {
          json(
            res,
            { code: 403, error_code: "otp_expired", msg: "Link expired" },
            403
          );
          return;
        }
        links.delete(String(body.token_hash));
        person.confirmed = true;
        await db`UPDATE auth.users SET email_confirmed_at=now() WHERE id=${person.id}`;
        json(res, session(person));
        return;
      }
      if (url.pathname === "/auth/v1/recover" && req.method === "POST") {
        inbox.push({
          to: String(JSON.parse(bytes.toString()).email),
          type: "recovery",
        });
        json(res, {});
        return;
      }
      if (url.pathname === "/auth/v1/token") {
        const body = JSON.parse(bytes.toString());
        const person = identities.find(
          (p) =>
            p.email === String(body.email ?? "").toLowerCase() ||
            `synthetic-${p.id}` === body.refresh_token
        );
        if (
          !person ||
          (body.password !== undefined &&
            body.password !== (person.password ?? password))
        ) {
          json(res, { message: "Invalid credentials" }, 400);
          return;
        }
        if (person.confirmed === false) {
          json(
            res,
            {
              code: 400,
              error_code: "email_not_confirmed",
              msg: "Email not confirmed",
            },
            400
          );
          return;
        }
        json(res, session(person));
        return;
      }
      if (url.pathname === "/auth/v1/user") {
        const person = verified(req);
        if (person && req.method === "PUT") {
          // An email change sends links to both addresses; nothing changes until they are used.
          const body = JSON.parse(bytes.toString());
          inbox.push({
            to: person.email,
            type: "email_change",
            newEmail: body.email,
          });
          json(res, { ...user(person), new_email: body.email });
          return;
        }
        json(
          res,
          person ? user(person) : { message: "Invalid JWT" },
          person ? 200 : 401
        );
        return;
      }
      // Auth Admin API (service role only): invitation and deletion, as GoTrue does them.
      if (
        url.pathname.startsWith("/auth/v1/admin/") ||
        url.pathname === "/auth/v1/invite"
      ) {
        if (req.headers.authorization !== `Bearer ${serviceKey}`) {
          json(res, { message: "Admin API needs the service role" }, 401);
          return;
        }
        const target = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(
          url.pathname
        )?.[1];
        if (target && req.method === "DELETE") {
          try {
            await db`DELETE FROM auth.users WHERE id = ${target}`;
          } catch {
            // A database reference blocks deletion, exactly like the real service.
            json(res, { code: 500, msg: "Database error deleting user" }, 500);
            return;
          }
          const index = identities.findIndex((p) => p.id === target);
          if (index >= 0) identities.splice(index, 1);
          json(res, {});
          return;
        }
        if (url.pathname === "/auth/v1/invite" && req.method === "POST") {
          const email = String(
            JSON.parse(bytes.toString()).email
          ).toLowerCase();
          if (identities.some((p) => p.email === email)) {
            json(
              res,
              {
                code: 422,
                error_code: "email_exists",
                msg: "A user with this email address has already been registered",
              },
              422
            );
            return;
          }
          const person: Person = {
            id: randomUUID(),
            email,
            name: "",
            role: "invited",
            confirmed: false,
          };
          identities.push(person);
          await db`INSERT INTO auth.users(id,email,invited_at) VALUES(${person.id},${email},now())`;
          inbox.push({ to: email, type: "invite" });
          json(res, user(person));
          return;
        }
        json(res, { message: "Unknown synthetic admin route" }, 404);
        return;
      }
      if (url.pathname === "/auth/v1/logout") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const person = verified(req);
        if (!person) {
          json(res, {}, 401);
          return;
        }
        if (url.pathname.endsWith("administrative_access")) {
          const rows =
            await db`SELECT access_level,committee_id FROM public.administrative_access WHERE user_id=${person.id} AND revoked_at IS NULL`;
          json(
            res,
            req.headers.accept?.includes("object") ? (rows[0] ?? null) : rows
          );
          return;
        }
        if (url.pathname.endsWith("committees")) {
          // RLS as Supabase applies it: a manager sees their committee, global roles the catalog.
          const rows =
            await db`SELECT c.* FROM public.committees c WHERE c.slug IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.administrative_access a WHERE a.user_id=${person.id} AND a.revoked_at IS NULL
                AND (a.access_level IN ('BOARD_ADMIN','TECHNICAL') OR a.committee_id = c.id)) ORDER BY c.name`;
          json(res, rows);
          return;
        }
      }
      if (
        url.pathname.startsWith("/storage/v1/s3/events-test/event-covers/") ||
        url.pathname.startsWith(
          "/storage/v1/s3/projects-test/project-images/"
        ) ||
        url.pathname.startsWith("/storage/v1/s3/photos-test/member-photos/") ||
        url.pathname.startsWith(
          "/storage/v1/s3/identity-test/membership-id-cards/"
        )
      ) {
        if (
          !req.headers.authorization?.startsWith(
            "AWS4-HMAC-SHA256 Credential=synthetic-access-key/"
          )
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        if (req.method === "PUT") {
          if (failNextCover) {
            failNextCover = false;
            res.writeHead(503);
            res.end();
            return;
          }
          if (
            createHash("sha256").update(bytes).digest("hex") !==
            req.headers["x-amz-content-sha256"]
          ) {
            res.writeHead(400);
            res.end();
            return;
          }
          objects.set(url.pathname, {
            bytes,
            type: String(req.headers["content-type"]),
          });
          res.writeHead(200);
          res.end();
          return;
        }
        if (req.method === "DELETE") {
          objects.delete(url.pathname);
          res.writeHead(204);
          res.end();
          return;
        }
        const object = objects.get(url.pathname);
        if (!object) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": object.type,
          "content-length": object.bytes.length,
        });
        res.end(object.bytes);
        return;
      }
      json(res, { message: "Unknown synthetic service route" }, 404);
    } catch {
      json(res, { message: "Synthetic service failure" }, 500);
    }
  });
  await new Promise<void>((resolve) => stub.listen(3602, "127.0.0.1", resolve));
  const key = `essq_test_eventflow_${randomBytes(32).toString("hex")}`;
  try {
    for (const person of identities) {
      await db`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${person.id},${person.email},now())`;
      if (person.role === "member")
        await db`INSERT INTO public.members(id,full_name,email,university_id) VALUES(${person.id},${person.name},${person.email},${person.id})`;
      else if (person.role === "BOARD_ADMIN" || person.role === "TECHNICAL")
        await db`INSERT INTO public.administrative_access(user_id,access_level,granted_by) VALUES(${person.id},${person.role},${person.id})`;
      else {
        const [{ id }] =
          await db`SELECT id FROM public.committees WHERE slug=${person.committee!}`;
        await db`INSERT INTO public.administrative_access(user_id,committee_id,access_level,granted_by) VALUES(${person.id},${id},'COMMITTEE_MANAGER',${person.id})`;
      }
    }
    await db`INSERT INTO private.api_clients(name,key_prefix,key_hash,environment,scopes) VALUES('Synthetic local event flow','eventflow',${createHash("sha256").update(key).digest("hex")},'staging',ARRAY['events:read'])`;
  } catch (error) {
    await db.end();
    stub.close();
    throw error;
  }
  const core = process.cwd();
  const website = resolve(core, "../ESWebsite");
  const production = process.env.EVENT_FLOW_PRODUCTION === "true";
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    VERCEL: "",
    VERCEL_ENV: "",
    LOCAL_REVIEW_MODE: "",
    ESSQU_EVENT_FLOW: "true",
    NODE_ENV: production ? "production" : "development",
  };
  const coreEnv = {
    ...baseEnv,
    APP_RUNTIME_DATABASE_URL: process.env.UC02_TEST_APP_RUNTIME_DATABASE_URL!,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3602",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    CORE_API_ALLOWED_ORIGINS: "http://127.0.0.1:3601",
    CORE_API_HOST_ENFORCEMENT: "false",
    APP_ORIGIN: "http://127.0.0.1:3600",
    PUBLIC_WEBSITE_ORIGIN: "http://127.0.0.1:3601",
    SUPABASE_S3_ENDPOINT: "http://127.0.0.1:3602/storage/v1/s3",
    SUPABASE_S3_REGION: "local-test",
    SUPABASE_S3_ACCESS_KEY_ID: "synthetic-access-key",
    SUPABASE_S3_SECRET_ACCESS_KEY: "synthetic-secret-key",
    SUPABASE_S3_MEMBERSHIP_BUCKET: "identity-test",
    SUPABASE_S3_EVENT_BUCKET: "events-test",
    SUPABASE_S3_PROJECT_BUCKET: "projects-test",
    SUPABASE_S3_MEMBER_PHOTO_BUCKET: "photos-test",
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  };
  const webEnv = {
    ...baseEnv,
    CORE_API_BASE_URL: "http://127.0.0.1:3600/v1",
    CORE_EVENTS_API_KEY: key,
    SUPABASE_URL: "http://127.0.0.1:3602",
    SUPABASE_ANON_KEY: anon,
  };
  const children: ChildProcess[] = [];
  function stopChildren() {
    for (const child of children) {
      if (process.platform === "win32" && child.pid)
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else child.kill();
    }
  }
  function start(
    cwd: string,
    port: string,
    env: NodeJS.ProcessEnv,
    label: string
  ) {
    const log = createWriteStream(
      join(tmpdir(), `essqu-event-flow-${label}.log`)
    );
    const child = spawn(
      process.execPath,
      [
        join(cwd, "node_modules/next/dist/bin/next"),
        ...(production ? ["start"] : ["dev", "--webpack"]),
        "--hostname",
        "127.0.0.1",
        "--port",
        port,
      ],
      { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    children.push(child);
  }
  start(core, "3600", coreEnv, "core");
  start(website, "3601", webEnv, "website");
  async function ready(url: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok)
          return;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `Local event test server did not start: ${url}; inspect temp essqu-event-flow logs`
    );
  }
  try {
    await Promise.all([
      ready("http://127.0.0.1:3600/admin/login"),
      ready("http://127.0.0.1:3601/login"),
    ]);
  } catch (error) {
    stopChildren();
    stub.close();
    await db.end();
    throw error;
  }
  return async () => {
    stopChildren();
    await new Promise<void>((r) => stub.close(() => r()));
    await db.end();
    await teardownDb?.();
  };
}
