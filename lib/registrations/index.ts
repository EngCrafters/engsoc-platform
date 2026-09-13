// Public entry point for the registrations domain. Code outside
// lib/registrations/ must import from here, never from ./db or ./types
// directly — that's what keeps this a deep module: the domain's
// implementation can change shape without every caller needing to know.
//
// No exports yet. UC-02 feature code fills this in as a separate, scoped
// piece of work — see CLAUDE.md's "Currently active" use case.

export * from "./types";
