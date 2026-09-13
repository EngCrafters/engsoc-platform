#!/usr/bin/env bash
# PreToolUse hook (Bash tool only). Blocks a short list of git commands that
# are destructive and hard to reverse: reset --hard, clean -f/-fd,
# branch -D, checkout . / restore . — see CLAUDE.md, "## 3. Standards
# tooling". This is a hard stop in addition to keeping tool confirmations
# on, not a replacement for it.
#
# git push was deliberately removed from this list per Hisham's
# instruction (2026-09-13) — pushing to origin is expected to be a normal
# part of the workflow now, not something that needs a manual override
# every time.
#
# Project scope only: lives in this repo's .claude/settings.json, not
# ~/.claude/settings.json.

set -euo pipefail

input="$(cat)"

# Pull tool_input.command out of the hook's stdin JSON. No jq dependency —
# this repo already has Node.js, so use it instead.
command="$(node -e '
let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(data);
    process.stdout.write(parsed.tool_input && parsed.tool_input.command ? parsed.tool_input.command : "");
  } catch {
    process.stdout.write("");
  }
});
' <<<"$input")"

if [ -z "$command" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
fi

pattern='git[[:space:]]+reset[[:space:]]+--hard'
pattern+='|git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f'
pattern+='|git[[:space:]]+branch[[:space:]]+(-D|-[a-zA-Z]*D)'
pattern+='|git[[:space:]]+(checkout|restore)([[:space:]]+--)?[[:space:]]+\.([[:space:]]|$)'

if echo "$command" | grep -Eq "$pattern"; then
  reason="Blocked by .claude/hooks/block-dangerous-git.sh: '$command' matches a destructive git command CLAUDE.md flags as a hard stop (reset --hard, clean -f/-fd, branch -D, checkout . / restore .). Ask Hisham to run it manually if it's actually needed."
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$reason")"
  exit 0
fi

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
