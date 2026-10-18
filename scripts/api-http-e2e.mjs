import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import postgres from "postgres";

const PORT = "55434";
const APP_PORT = "3300";
const NAME = "engsoc-api-e2e";
const ADMIN_URL =
  "postgres://postgres:postgres@127.0.0.1:" + PORT + "/uc02_test";
const R = {};
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const run = (cmd, args, opts) =>
  new Promise((res, rej) => {
    const c = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(opts ?? {}),
    });
    let o = "",
      e = "";
    c.stdout.on("data", (d) => (o += d));
    c.stderr.on("data", (d) => (e += d));
    c.on("close", (code) =>
      code === 0 ? res(o.trim()) : rej(new Error(cmd + ": " + e.slice(-400)))
    );
  });

await run("docker", ["rm", "--force", NAME]).catch(() => undefined);
await run("docker", [
  "run",
  "--detach",
  "--rm",
  "--name",
  NAME,
  "--env",
  "POSTGRES_PASSWORD=postgres",
  "--env",
  "POSTGRES_DB=uc02_test",
  "--publish",
  "127.0.0.1:" + PORT + ":5432",
  "postgres:17-alpine",
]);
let sql;
for (let i = 0; i < 80; i++) {
  try {
    const p = postgres(ADMIN_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 1,
    });
    await p.unsafe("SELECT 1");
    sql = p;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (!sql) throw new Error("no db");
await sql.unsafe(await readFile("scripts/api-http-e2e-bootstrap.sql", "utf8"));

const dir = join(process.cwd(), "db", "migrations");
const all = (await readdir(dir))
  .filter((f) => /^[0-9]{4}_.+\.sql$/.test(f))
  .sort();
for (const m of all) {
  if (m === "0016_application_access_hierarchy.sql") {
    const cid = randomUUID(),
      mgr = randomUUID();
    await sql.unsafe("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [
      mgr,
      "legacy@example.test",
    ]);
    await sql.unsafe("INSERT INTO public.committees (id,name) VALUES ($1,$2)", [
      cid,
      "Events",
    ]);
    await sql.unsafe(
      "INSERT INTO public.committee_managers (user_id,committee_id,granted_by) VALUES ($1,$2,$3)",
      [mgr, cid, mgr]
    );
  }
  await sql.unsafe(await readFile(join(dir, m), "utf8"));
}
R.migrationsApplied = all.length;

// Fixtures: one future published event, one past published, one draft, one capacity-1.
const cid = randomUUID();
await sql.unsafe("INSERT INTO public.committees (id,name) VALUES ($1,$2)", [
  cid,
  "Public Committee",
]);
const pub = randomUUID(),
  past = randomUUID(),
  draft = randomUUID(),
  cap1 = randomUUID();
const mkEvent = (id, title, offset, status, capacity) =>
  sql.unsafe(
    "INSERT INTO public.events (id,title,description,event_date,location,committee_id,status,capacity) VALUES ($1,$2,$3, now() + ($4)::interval, $5,$6,$7,$8)",
    [id, title, "Desc " + title, offset, "SQU", cid, status, capacity]
  );
await mkEvent(pub, "Public E2E", "10 days", "published", null);
await mkEvent(past, "Past E2E", "-3 days", "published", null);
await mkEvent(draft, "Draft E2E", "11 days", "draft", null);
await mkEvent(cap1, "Last Seat E2E", "12 days", "published", 1);

// API clients
const TOK = {
  valid: "essq_test_e2evalid001_" + "a".repeat(43),
  noscope: "essq_test_e2enoscope_" + "b".repeat(43),
};
const mkClient = (name, prefix, token, scopes) =>
  sql.unsafe(
    "INSERT INTO private.api_clients (name,key_prefix,key_hash,environment,scopes,active) VALUES ($1,$2,$3,$4,$5,$6)",
    [name, prefix, sha(token), "staging", scopes, true]
  );
await mkClient("E2E valid", "e2evalid001", TOK.valid, ["events:read"]);
await mkClient("E2E wrong scope", "e2enoscope", TOK.noscope, ["other:read"]);

// Start the built app.
const app = spawn(
  process.execPath,
  [
    join(process.cwd(), "node_modules", "next", "dist", "bin", "next"),
    "start",
    "-p",
    APP_PORT,
  ],
  {
    env: {
      ...process.env,
      APP_RUNTIME_DATABASE_URL: ADMIN_URL,
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder",
    },
    stdio: "ignore",
  }
);
const BASE = "http://127.0.0.1:" + APP_PORT;
try {
  let up = false;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + "/v1/events");
      if (r.status) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error("app never started");

  const call = async (path, init) => {
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, body: text, json };
  };
  const auth = (token) => ({ authorization: "Bearer " + token });
  const ORIGIN = "https://essqu.com";

  const noKey = await call("/v1/events");
  R.eventsNoKey = {
    status: noKey.status,
    wwwAuth: noKey.headers.get("www-authenticate"),
    reqId: !!noKey.headers.get("x-request-id"),
    code: noKey.json?.code,
  };
  const badKey = await call("/v1/events", {
    headers: auth("essq_test_badprefix1_" + "c".repeat(43)),
  });
  R.eventsBadKey = { status: badKey.status, code: badKey.json?.code };
  const wrongScope = await call("/v1/events", { headers: auth(TOK.noscope) });
  R.eventsWrongScope = {
    status: wrongScope.status,
    code: wrongScope.json?.code,
    wwwAuth: wrongScope.headers.get("www-authenticate"),
  };

  const ok = await call("/v1/events", { headers: auth(TOK.valid) });
  const leak = [
    "capacity",
    "committeeId",
    "committee_id",
    "revision",
    "registrationCount",
    "status",
    "approvedRevision",
  ].filter((k) => ok.body.includes(k));
  R.eventsValid = {
    status: ok.status,
    cache: ok.headers.get("cache-control"),
    count: ok.json?.data?.length,
    hasMeta: !!ok.json?.meta,
    nextCursor: ok.json?.meta?.nextCursor,
    keys: ok.json?.data?.[0] ? Object.keys(ok.json.data[0]).sort() : [],
    internalLeak: leak,
  };

  const pastRes = await call("/v1/events?period=past", {
    headers: auth(TOK.valid),
  });
  R.periodPast = {
    status: pastRes.status,
    titles: (pastRes.json?.data ?? []).map((e) => e.title),
  };

  const detailOk = await call("/v1/events/" + pub, {
    headers: auth(TOK.valid),
  });
  R.detailPublished = { status: detailOk.status, id: detailOk.json?.data?.id };
  const detailDraft = await call("/v1/events/" + draft, {
    headers: auth(TOK.valid),
  });
  const detailMissing = await call("/v1/events/" + randomUUID(), {
    headers: auth(TOK.valid),
  });
  const detailBad = await call("/v1/events/not-a-uuid", {
    headers: auth(TOK.valid),
  });
  R.detailPrivacy = {
    draft: detailDraft.status,
    missing: detailMissing.status,
    malformed: detailBad.status,
    sameBody: detailDraft.body === detailMissing.body,
  };

  const pre = await call("/v1/events/" + pub + "/registrations", {
    method: "OPTIONS",
    headers: { origin: ORIGIN },
  });
  R.preflightAllowed = {
    status: pre.status,
    allowOrigin: pre.headers.get("access-control-allow-origin"),
    methods: pre.headers.get("access-control-allow-methods"),
    credentials: pre.headers.get("access-control-allow-credentials"),
  };
  const preForeign = await call("/v1/events/" + pub + "/registrations", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  });
  R.preflightForeign = {
    status: preForeign.status,
    allowOrigin: preForeign.headers.get("access-control-allow-origin"),
  };

  const regPost = (body, headers) =>
    call("/v1/events/" + pub + "/registrations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-vercel-forwarded-for": "203.0.113.20",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  R.postForeignOrigin = (
    await regPost(
      { attendeeName: "X", attendeeEmail: "x@example.test" },
      { origin: "https://evil.example" }
    )
  ).status;
  R.postMalformed = (await regPost("{nope")).status;
  R.postWrongType = (
    await regPost(
      { attendeeName: "X", attendeeEmail: "x@example.test" },
      { "content-type": "text/plain" }
    )
  ).status;
  R.postOversized = (
    await regPost({
      attendeeName: "X",
      attendeeEmail: "x@example.test",
      pad: "z".repeat(20000),
    })
  ).status;
  const ipField = await regPost({
    attendeeName: "X",
    attendeeEmail: "x@example.test",
    ipAddress: "1.2.3.4",
  });
  R.postClientIpRejected = {
    status: ipField.status,
    errors: ipField.json?.errors,
  };
  R.postMissingEmail = (await regPost({ attendeeName: "Only" })).status;

  const uniqueEmail = "e2e-" + randomUUID() + "@example.test";
  const created = await regPost({
    attendeeName: "E2E Attendee",
    attendeeEmail: uniqueEmail,
  });
  R.postSuccess = {
    status: created.status,
    body: created.json,
    cache: created.headers.get("cache-control"),
    allowOrigin: created.headers.get("access-control-allow-origin"),
    reqId: !!created.headers.get("x-request-id"),
    leaksEmail: created.body.includes(uniqueEmail),
  };
  const dupe = await regPost({
    attendeeName: "E2E Attendee",
    attendeeEmail: uniqueEmail,
  });
  R.postDuplicate = { status: dupe.status, code: dupe.json?.code };

  // HTTP concurrency on a capacity-1 event: two simultaneous requests.
  const capPost = (email, ip) =>
    call("/v1/events/" + cap1 + "/registrations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-vercel-forwarded-for": ip,
      },
      body: JSON.stringify({
        attendeeName: "Race " + email,
        attendeeEmail: email,
      }),
    });
  const [r1, r2] = await Promise.all([
    capPost("race-a-" + randomUUID() + "@example.test", "198.51.100.31"),
    capPost("race-b-" + randomUUID() + "@example.test", "198.51.100.32"),
  ]);
  const confirmedRows = (
    await sql.unsafe(
      "SELECT count(*)::int AS n FROM public.registrations WHERE event_id=$1 AND status=$2",
      [cap1, "confirmed"]
    )
  )[0].n;
  R.concurrencyCapacity1 = {
    statuses: [r1.status, r2.status],
    confirmedRows,
    oversubscribed: confirmedRows > 1,
  };
} finally {
  app.kill();
  await sql.end({ timeout: 5 }).catch(() => undefined);
  await run("docker", ["rm", "--force", NAME]).catch(() => undefined);
}
console.log(JSON.stringify(R, null, 1));
