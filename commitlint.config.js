// Enforces Conventional Commits (feat:, fix:, docs:, etc.), the format
// already documented in CLAUDE.md. This makes it a real rule, not just a
// written one, a commit that doesn't follow the format is rejected before
// it's even made.
//
// UC-numbered work should still reference the use case in the description,
// e.g. `feat(uc-01): add duplicate email check`, that part isn't enforced by
// tooling, it's enforced by Hisham's review.

module.exports = {
  extends: ["@commitlint/config-conventional"],
};
