// Keeps the browser harness's isolated two-app stack running for manual testing:
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:<port>/uc02_test npm run local:stack
//
// It is the same setup the browser suites use (tests/event-flow/setup.ts): every migration replayed
// into a fresh, empty loopback database whose name contains `uc02_test` (the setup refuses any
// other target), synthetic Auth and S3 adapters on 3602, Core on 3600 and the website
// (../ESWebsite) on 3601. Nothing reaches a hosted project, and every account is synthetic. Ctrl+C
// stops the servers; recreate the database before the next run.
import setup from "./setup";

const accounts = [
  ["event-member@example.test", "member (no dashboard access)"],
  [
    "project-reviewer@example.test",
    "Society Affairs manager (reviews SQU and leadership)",
  ],
  [
    "board-admin@example.test",
    "Board Administration (reviews; teams; appoints)",
  ],
  [
    "technical-admin@example.test",
    "Technical (teams and settings; no review authority)",
  ],
  ["event-manager@example.test", "Media Committee manager"],
];

async function main() {
  console.log(
    "Starting the isolated local stack (fresh database, synthetic Auth and S3)…"
  );
  const teardown = await setup();
  console.log(`
Ready.
  Website:    http://127.0.0.1:3601   (/register, /login, /profile)
  Dashboard:  http://127.0.0.1:3600/admin/login
  Core API:   http://127.0.0.1:3600/v1/health

Synthetic accounts, all with the password Synthetic-test-password-42!:
${accounts.map(([email, role]) => `  ${email.padEnd(32)} ${role}`).join("\n")}

Server logs: essqu-event-flow-core.log and essqu-event-flow-website.log in the system temp folder.
Data lives only in the disposable database; recreate it before the next run.
Press Ctrl+C to stop.`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping…");
    await teardown?.();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
