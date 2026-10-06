import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Only repository-owned files belong to this gate. Local review artifacts and
// user-managed untracked skill directories must not make it fail.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(
    (file) =>
      existsSync(file) &&
      /\.(?:[cm]?[jt]sx?|json|css|md|html|ya?ml)$/.test(file)
  );
const prettier = join(
  process.cwd(),
  "node_modules",
  "prettier",
  "bin",
  "prettier.cjs"
);
const result = spawnSync(process.execPath, [prettier, "--check", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
