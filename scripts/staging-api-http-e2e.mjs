import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { assertStagingHttpTarget } from "./lib/staging-http-target.mjs";
import { STAGING_PROJECT_REF } from "./lib/supabase-target.mjs";
import { submitStagingRegistration } from "./lib/staging-browser-registration.mjs";

// This is deliberately separate from the hermetic unit suite and local diagnostic.
// Provision a preview with staging app_runtime first; never start a privileged app.
const env = process.env;
if (
  typeof env.CORE_HTTP_E2E_LANDING_OIDC_TOKEN !== "string" ||
  !/^\S+$/.test(env.CORE_HTTP_E2E_LANDING_OIDC_TOKEN)
) {
  throw new Error(
    "Full staging HTTP E2E requires a Landing preview identity before fixture setup"
  );
}
const base = assertStagingHttpTarget(env);
const origin = "https://essqu-web-git-staging-eng-crafters.vercel.app";
const runId = randomUUID();
const cid = randomUUID();
const ids = Object.fromEntries(
  ["open", "closed", "draft", "archived", "race"].map((name) => [
    name,
    randomUUID(),
  ])
);
const pages = Array.from({ length: 23 }, () => randomUUID());
const allIds = [...Object.values(ids), ...pages];
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const inIds = allIds.map(quote).join(",");
const checks = [];
const temp = await mkdtemp(join(tmpdir(), "essqu-staging-http-"));
let sqlSequence = 0;
let fixturesAttempted = false;
let stage = "fixture setup";
let expectedHttpStatus = null;
let lastHttp = null;
console.log(`Starting staging HTTP E2E synthetic run ${runId}`);

function cli(args) {
  return new Promise((resolve, reject) => {
    const cliPath = env.SUPABASE_CLI_PATH || "supabase";
    const javascriptCli = /\.[cm]?js$/i.test(cliPath);
    const child = spawn(
      javascriptCli ? process.execPath : cliPath,
      javascriptCli ? [cliPath, ...args] : args,
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 120000,
      }
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    // CLI diagnostics can contain SQL, connection information or supplied data.
    child.stderr.on("data", () => {});
    child.on("error", () => reject(new Error("Supabase CLI unavailable")));
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              "Staging fixture query failed; private diagnostics suppressed"
            )
          )
    );
  });
}

async function query(sql) {
  const file = join(temp, `query-${++sqlSequence}.sql`);
  await writeFile(file, sql, { mode: 0o600 });
  const output = await cli([
    "db",
    "query",
    "--linked",
    "--project-ref",
    STAGING_PROJECT_REF,
    "--file",
    file,
    "--output",
    "json",
  ]);
  // Read-only checks use a single SELECT. CLI versions may wrap the row list.
  const parsed = JSON.parse(output);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  if (Array.isArray(parsed?.result)) return parsed.result;
  throw new Error("Unrecognized staging query JSON output");
}

async function request(path, init = {}) {
  const rid = `staging-http-${randomUUID()}`;
  const response = await fetch(base + "/v1" + path, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      "x-request-id": rid,
      ...(env.CORE_HTTP_E2E_OIDC_TOKEN
        ? { "x-vercel-trusted-oidc-idp-token": env.CORE_HTTP_E2E_OIDC_TOKEN }
        : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const safeCodes = new Set([
    "bad-request",
    "unsupported-media-type",
    "payload-too-large",
    "invalid-fields",
    "unauthorized",
    "forbidden",
    "not-found",
    "conflict",
    "rate-limited",
    "service-unavailable",
  ]);
  const cache = response.headers.get("x-vercel-cache");
  lastHttp = {
    expectedStatus: expectedHttpStatus,
    actualStatus: response.status,
    code: safeCodes.has(body?.code) ? body.code : null,
    requestIdEcho: response.headers.get("x-request-id") === rid,
    cache: ["HIT", "MISS", "STALE", "BYPASS", "PRERENDER"].includes(cache)
      ? cache
      : null,
    publicCache: /public/.test(response.headers.get("cache-control") ?? ""),
    privateCache: /private/.test(response.headers.get("cache-control") ?? ""),
    noStore: /no-store/.test(response.headers.get("cache-control") ?? ""),
  };
  assert.equal(
    response.headers.get("x-request-id"),
    rid,
    "request id must be echoed"
  );
  return {
    response,
    body,
    text,
    status: response.status,
    headers: response.headers,
  };
}

const auth = (key = env.CORE_HTTP_E2E_READ_KEY) => ({
  authorization: `Bearer ${key}`,
});
function problem(result, status, code, reason) {
  if (lastHttp) lastHttp.expectedStatus = status;
  assert.equal(result.status, status, "unexpected problem status");
  assert.equal(result.body?.code, code, "unexpected public problem code");
  assert.equal(result.body?.status, status);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(
    result.headers.get("content-type") ?? "",
    /^application\/problem\+json/
  );
  assert.equal(result.body?.reason, reason);
  assert(
    !/register_for_event|private\.|postgres|supabase|essq_(test|live)_|@example\.test/i.test(
      result.text
    ),
    "problem leaks internals or fixture identity"
  );
}
function cors(result, allowed = true) {
  assert.equal(
    result.headers.get("access-control-allow-origin"),
    allowed ? origin : null
  );
  assert.equal(result.headers.get("access-control-allow-credentials"), null);
  assert.match(result.headers.get("vary") ?? "", /Origin/i);
  assert.equal(
    result.headers.get("access-control-expose-headers"),
    allowed ? "X-Request-Id, Retry-After" : null
  );
}
function eventShape(event) {
  assert.deepEqual(
    Object.keys(event).sort(),
    [
      "id",
      "title",
      "description",
      "eventDate",
      "location",
      "committeeName",
      "availability",
    ].sort(),
    "event projection leaked or lost fields"
  );
  assert(["open", "waitlist", "closed"].includes(event.availability));
}
const identity = (label) => ({
  attendeeName: "Synthetic staging visitor",
  attendeeEmail: `${runId}-${label}@example.test`,
});
const post = (id, body, headers = {}) =>
  request(`/events/${id}/registrations`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
function success(result, status) {
  assert.equal(
    result.status,
    201,
    "registration unexpectedly refused (a shared egress may already be rate limited)"
  );
  assert.deepEqual(result.body, { data: { status } });
  assert.equal(result.headers.get("cache-control"), "no-store");
  cors(result);
}

try {
  // No implicit linked target and no database password passed on argv.
  const help = await cli(["db", "query", "--help"]);
  assert(
    help.includes("--linked") &&
      help.includes("--project-ref") &&
      help.includes("--file"),
    "CLI lacks explicit management query support"
  );
  const role = (
    await query(`SELECT rolsuper, rolbypassrls,
    (SELECT count(*)::int FROM information_schema.role_table_grants
      WHERE grantee = 'app_runtime' AND table_schema IN ('public','private')) AS table_privileges
    FROM pg_roles WHERE rolname = 'app_runtime';`)
  )[0];
  assert.equal(role?.rolsuper, false);
  assert.equal(role?.rolbypassrls, false);
  assert.equal(Number(role?.table_privileges), 0);

  const eventRows = [
    [ids.open, "open", "30 days", "published", "NULL", "NULL"],
    [ids.closed, "closed", "-30 days", "published", "NULL", "NULL"],
    [ids.draft, "draft", "31 days", "draft", "NULL", "NULL"],
    [ids.archived, "archived", "32 days", "published", "NULL", "now()"],
    [ids.race, "race", "33 days", "published", "1", "NULL"],
    ...pages.map((id, i) => [
      id,
      `page-${i}`,
      `${40 + i} days`,
      "published",
      "NULL",
      "NULL",
    ]),
  ]
    .map(
      ([id, label, date, status, capacity, archived]) =>
        `(${quote(id)},${quote(`HTTP staging ${runId} ${label}`)},'Synthetic fixture only',now()+interval ${quote(date)},'SQU',${quote(cid)},${quote(status)},${capacity},${archived})`
    )
    .join(",\n");
  fixturesAttempted = true;
  await query(`BEGIN;
    INSERT INTO public.committees (id,name) VALUES (${quote(cid)},${quote(`HTTP staging ${runId}`)});
    INSERT INTO public.events (id,title,description,event_date,location,committee_id,status,capacity,archived_at)
      VALUES ${eventRows};
    COMMIT;
    SELECT true AS fixtures_ready;`);

  stage = "HTTP initial staging fixture detail";
  expectedHttpStatus = 200;
  // Positive unpredictable fixture proves the HTTP deployment reaches staging
  // before any registration write is attempted. Its key exists only in staging.
  const detail = await request(`/events/${ids.open}`, { headers: auth() });
  assert.equal(detail.status, 200);
  assert.equal(detail.body?.data?.id, ids.open);
  eventShape(detail.body.data);
  for (const path of ["/events", `/events/${ids.open}`]) {
    const resource = path === "/events" ? "list" : "detail";
    stage = `HTTP ${resource} missing credential`;
    expectedHttpStatus = 401;
    const absent = await request(path);
    problem(absent, 401, "unauthorized");
    assert.equal(absent.headers.get("www-authenticate"), "Bearer");
    stage = `HTTP ${resource} unknown credential`;
    problem(
      await request(path, {
        headers: auth("essq_test_unknownfixture_" + "x".repeat(43)),
      }),
      401,
      "unauthorized"
    );
    stage = `HTTP ${resource} valid credential missing scope`;
    expectedHttpStatus = 403;
    const denied = await request(path, {
      headers: auth(env.CORE_HTTP_E2E_NO_SCOPE_KEY),
    });
    problem(denied, 403, "forbidden");
    assert.equal(denied.headers.get("www-authenticate"), null);
  }
  const seen = new Set();
  let cursor;
  let pageCount = 0;
  do {
    stage = "HTTP upcoming pagination";
    expectedHttpStatus = 200;
    const page = await request(
      "/events?period=upcoming" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      { headers: auth() }
    );
    stage = "HTTP upcoming page status";
    assert.equal(page.status, 200);
    // Vercel can consume s-maxage before returning Cache-Control to the client.
    stage = "HTTP upcoming page public Cache-Control policy";
    assert.match(page.headers.get("cache-control") ?? "", /public/);
    stage = "HTTP upcoming page array and page-size bound";
    assert(Array.isArray(page.body?.data) && page.body.data.length <= 20);
    for (const event of page.body.data) {
      stage = "HTTP upcoming event exact DTO shape";
      eventShape(event);
      stage = "HTTP upcoming no repeated IDs across cursor pages";
      assert(!seen.has(event.id), "cursor pages repeat an event");
      seen.add(event.id);
    }
    stage = "HTTP upcoming nextCursor shape";
    cursor = page.body.meta.nextCursor;
    assert(cursor === null || typeof cursor === "string");
    stage = "HTTP upcoming cursor terminates within safety bound";
    assert(++pageCount <= 100, "cursor did not terminate within safety bound");
  } while (cursor);
  stage = "HTTP upcoming all published fixture IDs present";
  for (const id of [ids.open, ids.race, ...pages])
    assert(seen.has(id), "public fixture missing from pagination");
  stage = "HTTP upcoming past and nonpublic fixture IDs absent";
  for (const id of [ids.closed, ids.draft, ids.archived])
    assert(!seen.has(id), "hidden or past event leaked into upcoming");
  stage = "HTTP upcoming fixture catalog spans at least two pages";
  assert(pageCount >= 2);
  const pastIds = new Set();
  cursor = null;
  let pastPageCount = 0;
  do {
    stage = "HTTP past pagination";
    expectedHttpStatus = 200;
    const past = await request(
      "/events?period=past" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      { headers: auth() }
    );
    assert.equal(past.status, 200);
    assert(Array.isArray(past.body?.data) && past.body.data.length <= 20);
    for (const event of past.body.data) {
      eventShape(event);
      assert(!pastIds.has(event.id), "past cursor repeats an event");
      pastIds.add(event.id);
    }
    cursor = past.body.meta.nextCursor;
    assert(cursor === null || typeof cursor === "string");
    assert(++pastPageCount <= 100, "past cursor did not terminate");
  } while (cursor);
  assert(pastIds.has(ids.closed), "past event missing from past catalog");
  for (const id of [ids.open, ids.race, ids.draft, ids.archived, ...pages])
    assert(!pastIds.has(id), "future or hidden fixture leaked into past");
  assert.equal(
    (await request(`/events/${ids.closed}`, { headers: auth() })).body?.data
      ?.availability,
    "closed"
  );
  for (const id of [ids.draft, ids.archived, randomUUID(), "not-a-uuid"]) {
    stage = "HTTP nonpublic detail privacy";
    expectedHttpStatus = 404;
    problem(
      await request(`/events/${id}`, { headers: auth() }),
      404,
      "not-found"
    );
  }
  checks.push(
    "reads: credentials, scope, exact public fields, hidden events, cursor, cache and request IDs"
  );

  stage = "CORS and body validation";
  for (const allowed of [true, false]) {
    stage = allowed
      ? "HTTP allowed-origin preflight"
      : "HTTP foreign-origin preflight";
    expectedHttpStatus = 204;
    const pre = await request(`/events/${ids.open}/registrations`, {
      method: "OPTIONS",
      headers: { origin: allowed ? origin : "https://evil.example" },
    });
    assert.equal(pre.status, 204);
    cors(pre, allowed);
    if (allowed)
      assert.match(
        pre.headers.get("access-control-allow-methods") ?? "",
        /POST/
      );
  }
  stage = "HTTP foreign-origin registration refusal";
  expectedHttpStatus = 403;
  const foreign = await post(ids.open, identity("foreign"), {
    origin: "https://evil.example",
  });
  problem(foreign, 403, "forbidden");
  cors(foreign, false);
  for (const [body, headers, status, code] of [
    ["{nope", {}, 400, "bad-request"],
    [
      identity("type"),
      { "content-type": "text/plain" },
      415,
      "unsupported-media-type",
    ],
    [
      { ...identity("oversized"), pad: "z".repeat(20000) },
      {},
      413,
      "payload-too-large",
    ],
    [{ attendeeName: "Only" }, {}, 422, "invalid-fields"],
    [
      { ...identity("ip"), ipAddress: "203.0.113.99" },
      {},
      422,
      "invalid-fields",
    ],
  ]) {
    stage = `HTTP transport validation ${code}`;
    expectedHttpStatus = status;
    const result = await post(ids.open, body, headers);
    problem(result, status, code);
    cors(result);
  }
  checks.push(
    "CORS: allowed/foreign preflight, exposed headers and transport body refusals"
  );

  stage = "registration window one";
  expectedHttpStatus = 409;
  problem(
    await post(ids.closed, identity("closed")),
    409,
    "conflict",
    "registration-closed"
  );
  problem(
    await post(ids.open, { ...identity("available"), intent: "join_waitlist" }),
    409,
    "conflict",
    "registration-available"
  );
  const racers = [identity("race-a"), identity("race-b")];
  stage = "HTTP simultaneous capacity-one registrations";
  expectedHttpStatus = null;
  const race = await Promise.all(racers.map((body) => post(ids.race, body)));
  assert.deepEqual(race.map((result) => result.status).sort(), [201, 409]);
  for (const result of race) {
    if (result.status === 201) success(result, "confirmed");
    else problem(result, 409, "conflict", "event-full");
  }
  const count = (
    await query(
      `SELECT count(*)::int AS confirmed FROM public.registrations WHERE event_id=${quote(ids.race)} AND status='confirmed';`
    )
  )[0];
  assert.equal(Number(count?.confirmed), 1, "capacity one was oversubscribed");
  stage = "HTTP full capacity registration refusal";
  expectedHttpStatus = 409;
  problem(
    await post(ids.race, identity("full")),
    409,
    "conflict",
    "event-full"
  );
  checks.push(
    "registration: closed, seats available, capacity-one concurrency and full conflict"
  );

  // The real edge IP is deliberately NOT spoofed. Five canonical attempts have
  // consumed this IP's window; preserve its rows and wait for natural expiry.
  stage = "canonical rate-limit cooldown";
  for (let seconds = 610; seconds > 0; seconds -= 30) {
    console.log(
      `Staging HTTP E2E waiting for canonical limiter: ${seconds}s remaining`
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(seconds, 30) * 1000)
    );
  }

  stage = "registration window two";
  const waitlisted = { ...identity("waitlist"), intent: "join_waitlist" };
  stage = "HTTP explicit waitlist acceptance";
  expectedHttpStatus = 201;
  success(await post(ids.race, waitlisted), "waitlisted");
  stage = "HTTP duplicate waitlist refusal";
  expectedHttpStatus = 409;
  problem(
    await post(ids.race, waitlisted),
    409,
    "conflict",
    "already-waitlisted"
  );
  const attendee = identity("confirmed");
  stage = "HTTP normal registration acceptance";
  expectedHttpStatus = 201;
  success(await post(ids.open, attendee), "confirmed");
  stage = "HTTP duplicate registration refusal";
  expectedHttpStatus = 409;
  problem(
    await post(ids.open, attendee),
    409,
    "conflict",
    "already-registered"
  );
  stage = "HTTP fifth rate-window registration acceptance";
  expectedHttpStatus = 201;
  success(
    await submitStagingRegistration({
      eventId: ids.open,
      ...identity("fifth"),
      landingOidcToken: env.CORE_HTTP_E2E_LANDING_OIDC_TOKEN,
    }),
    "confirmed"
  );
  stage = "HTTP sixth rate-window attempt refused";
  expectedHttpStatus = 429;
  const limited = await post(ids.open, identity("limited"));
  problem(limited, 429, "rate-limited");
  cors(limited);
  assert.equal(limited.headers.get("retry-after"), "600");
  const persisted = (
    await query(`SELECT
    count(*) FILTER (WHERE status='confirmed')::int AS confirmed,
    count(*) FILTER (WHERE status='waitlisted')::int AS waitlisted
    FROM public.registrations WHERE event_id IN (${inIds});`)
  )[0];
  assert.equal(Number(persisted?.confirmed), 3);
  assert.equal(Number(persisted?.waitlisted), 1);
  stage = "read-only synthetic registration audit consistency";
  const audit = (
    await query(`SELECT
    count(*) FILTER (WHERE a.action='registration.created')::int AS confirmed_audits,
    count(*) FILTER (WHERE a.action='registration.waitlisted')::int AS waitlisted_audits,
    count(*) FILTER (WHERE a.actor_kind='anonymous' AND a.actor_user_id IS NULL
      AND a.event_id=r.event_id AND a.changes->>'status'=r.status::text)::int AS consistent_audits
    FROM private.uc02_audit a JOIN public.registrations r ON r.id=a.registration_id
    WHERE a.committee_id=${quote(cid)} AND a.event_id IN (${inIds});`)
  )[0];
  assert.equal(Number(audit?.confirmed_audits), Number(persisted?.confirmed));
  assert.equal(Number(audit?.waitlisted_audits), Number(persisted?.waitlisted));
  assert.equal(Number(audit?.consistent_audits), 4);
  const order = (
    await query(`SELECT
    (SELECT min(registered_at) FROM public.registrations WHERE event_id=${quote(ids.race)} AND status='waitlisted')
    >= (SELECT min(registered_at) FROM public.registrations WHERE event_id=${quote(ids.race)} AND status='confirmed') AS waitlist_after_seat;`)
  )[0];
  assert.equal(order?.waitlist_after_seat, true);
  checks.push(
    "registration: confirmed, duplicate, explicit waitlist, duplicate waitlist and true per-IP 429"
  );
  checks.push(
    "audit: each successful synthetic registration has its matching anonymous status audit; waitlist follows seat allocation"
  );
} catch {
  // Never dump fetch URLs, assertion actual values, CLI diagnostics, keys or PII.
  console.error(
    `FAIL staging HTTP E2E at ${stage}; private diagnostics suppressed`
  );
  if (lastHttp) console.error(JSON.stringify({ http: lastHttp }));
  process.exitCode = 1;
} finally {
  if (fixturesAttempted) {
    try {
      // Exact run-owned IDs only, including audit FKs before registrations.
      await query(`BEGIN;
        DELETE FROM private.uc02_audit WHERE committee_id=${quote(cid)} AND event_id IN (${inIds});
        DELETE FROM public.registrations WHERE event_id IN (${inIds});
        DELETE FROM public.events WHERE committee_id=${quote(cid)} AND id IN (${inIds});
        DELETE FROM public.committees WHERE id=${quote(cid)} AND name=${quote(`HTTP staging ${runId}`)};
        COMMIT;
        SELECT (SELECT count(*) FROM public.events WHERE id IN (${inIds}))::int AS remaining_events,
          (SELECT count(*) FROM public.committees WHERE id=${quote(cid)})::int AS remaining_committees;`).then(
        (rows) => {
          assert.equal(Number(rows[0]?.remaining_events), 0);
          assert.equal(Number(rows[0]?.remaining_committees), 0);
        }
      );
      checks.push(
        "cleanup: exact run-owned fixture events, registrations, audit and committee removed"
      );
    } catch {
      console.error(
        `FAIL staging fixture cleanup; retained synthetic run ${runId}`
      );
      process.exitCode = 1;
    }
  }
  await rm(temp, { recursive: true, force: true });
}
console.log(
  JSON.stringify(
    { result: process.exitCode ? "FAIL" : "PASS", checks },
    null,
    2
  )
);
