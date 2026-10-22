/** Display labels for the Administration section (ADR 0024). Safe for client components. */
export const ACTIVITY_LABELS: Record<string, string> = {
  "committee.created": "Committee created",
  "committee.updated": "Committee edited",
  "committee.archived": "Committee archived",
  "committee.restored": "Committee restored",
  "committee.member_added": "Member added to committee",
  "committee.member_updated": "Committee responsibility changed",
  "committee.member_removed": "Member removed from committee",
  "manager.assigned": "Manager assigned",
  "manager.reassigned": "Manager reassigned",
  "manager.revoked": "Manager access revoked",
  "board_admin.granted": "Board Administration granted",
  "board_admin.revoked": "Board Administration revoked",
  "technical.granted": "Technical access granted",
  "technical.revoked": "Technical access revoked",
  "access.suspended": "Access suspended",
  "access.reactivated": "Access reactivated",
  "user.created": "Account created",
  "user.invited": "Account invited",
  "event.deleted": "Event deleted permanently",
  "project.deleted": "Project deleted permanently",
  "member.deleted": "Membership record deleted",
  "account.erasure_started": "Account erasure started",
  "account.erased": "Account erased",
};

export function activityLabel(action: string) {
  return ACTIVITY_LABELS[action] ?? action;
}

export function actorLabel(row: { actor: string | null; actorKind: string }) {
  if (row.actorKind === "erased") return "Erased account";
  if (row.actorKind === "migration") return "Migration";
  return row.actor ?? "Unknown account";
}

export function formatWhen(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Muscat",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDay(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Asia/Muscat",
    dateStyle: "medium",
  });
}

/** The permission matrix of ADR 0024, mirrored for display; the database enforces it. */
export const PERMISSION_MATRIX: {
  capability: string;
  technical: string;
  board: string;
  manager: string;
}[] = [
  {
    capability: "Administration section",
    technical: "Yes",
    board: "Yes",
    manager: "No",
  },
  {
    capability: "Create, edit, archive committees",
    technical: "Yes",
    board: "Yes",
    manager: "No",
  },
  {
    capability: "Committee rosters",
    technical: "Yes",
    board: "Yes",
    manager: "No",
  },
  {
    capability: "Assign, replace, suspend managers",
    technical: "Yes",
    board: "Committee Managers only",
    manager: "No",
  },
  {
    capability: "Grant or revoke Board Administration",
    technical: "Yes",
    board: "No",
    manager: "No",
  },
  {
    capability: "Grant, revoke, suspend Technical",
    technical: "Yes (never the last owner)",
    board: "No",
    manager: "No",
  },
  {
    capability: "Invite accounts",
    technical: "Any role",
    board: "Committee Managers, by email",
    manager: "No",
  },
  {
    capability: "Password reset, temporary password",
    technical: "Yes",
    board: "No",
    manager: "No",
  },
  {
    capability: "Delete events and projects permanently",
    technical: "Yes",
    board: "Yes",
    manager: "No",
  },
  {
    capability: "Delete a membership record",
    technical: "Yes",
    board: "Yes",
    manager: "No",
  },
  {
    capability: "Delete a sign-in account completely",
    technical: "Yes",
    board: "No",
    manager: "No",
  },
  {
    capability: "Own committee's events and registrations",
    technical: "All committees",
    board: "All committees",
    manager: "Own committee",
  },
];
