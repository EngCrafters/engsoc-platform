// Shapes returned by the verification and leadership routines of migration
// 0033 (ADR 0025). The routines build these objects; nothing here adds data.

export type Localized = { en: string; ar: string | null };
export type CodeResult = { code: string; field?: string } & Record<
  string,
  unknown
>;

/** A member-facing SQU state. Never a reviewer note or the full student number. */
export type SquState = {
  status: "not_verified" | "pending" | "verified" | "rejected" | "revoked";
  studentNumber: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  submissionsPer30Days: number;
  recentSubmissions: number;
  canSubmit: boolean;
  nextSubmissionAt: string | null;
};

export type TeamSummary = {
  id: string;
  name: Localized;
  description: { en: string | null; ar: string | null };
  status: "active" | "inactive" | "archived";
};
export type PositionSummary = { id: string; label: Localized };

/**
 * Where a leadership request or appointment sits (ADR 0026): always a committee, and a team only
 * for team leadership. Committee-level leadership has `team: null`.
 */
export type LeadershipLevel = "committee" | "team";

/** The member's own SQU student verification (`GET /v1/me/verification`). */
export type OwnSquVerification = { code: "SUCCESS" } & SquState;

/** The member's own committee leadership (`GET /v1/me/leadership`). */
export type OwnLeadership = {
  code: "SUCCESS";
  /** Whether new requests are accepted (ADR 0026); appointments show either way. */
  requestsOpen: boolean;
  appointments: {
    id: string;
    active: boolean;
    appointedAt: string;
    endedAt: string | null;
    endReason: string | null;
    committee: { id: string; name: string; archived: boolean };
    team: TeamSummary | null;
    level: LeadershipLevel;
    position: PositionSummary;
    /** Active and its committee or team has dashboard permissions (0035, ADR 0027). */
    grantsAccess?: boolean;
  }[];
  requests: {
    id: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    submittedAt: string;
    decidedAt: string | null;
    rejectionReason: string | null;
    cancellationReason:
      | "team_moved"
      | "team_inactive"
      | "team_archived"
      | "committee_archived"
      | null;
    committee: { id: string; name: string; archived: boolean };
    team: TeamSummary | null;
    level: LeadershipLevel;
    position: PositionSummary;
  }[];
  /** recentRequests leaves out requests the structure cancelled. */
  limits: {
    requestsPer30Days: number;
    recentRequests: number;
    maxActiveAppointments: number | null;
    activeAppointments: number;
  };
  /** Whether the member has any dashboard permission: an access level, or a position's (ADR 0027). */
  dashboardAccess: boolean;
};

/** Every active committee, each with its active teams (possibly none). */
export type LeadershipOptions = {
  code: "SUCCESS";
  requestsOpen: boolean;
  committees: { id: string; name: string; teams: TeamSummary[] }[];
  positions: PositionSummary[];
};

export type SquListState = "pending" | "verified" | "rejected" | "revoked";
export type SquListItem = {
  id: string;
  memberId: string;
  name: string;
  email: string;
  state: SquListState;
  submittedAt: string;
  decidedAt: string | null;
  own: boolean;
  hasDocument: boolean;
};

export type MemberSummary = {
  id: string;
  name: string;
  email: string;
  memberSince: string;
  universityId?: string | null;
  category: string | null;
  categoryLabel: { en: string; ar: string } | null;
  institution: { id: string; en: string; ar: string } | null;
  institutionName: string | null;
};

export type HistoryEntry = {
  occurredAt: string;
  action: string;
  actorKind: string;
  actorEmail: string | null;
  changes?: Record<string, unknown>;
};

export type SquDetail = {
  code: "SUCCESS";
  reviewer: "senior" | "reviewer" | "society_affairs";
  own: boolean;
  request: {
    id: string;
    studentNumber: string;
    status: "pending" | "approved" | "rejected";
    state: SquListState;
    submittedAt: string;
    decidedAt: string | null;
    decidedByEmail: string | null;
    rejectionReason: string | null;
    reviewerNote: string | null;
    revision: number;
    documentDeletedAt: string | null;
    document: { mediaType: string; byteSize: number } | null;
  };
  verification: {
    id: string;
    verifiedAt: string;
    verifiedByEmail: string | null;
    revokedAt: string | null;
    revokedByEmail: string | null;
    revocationReason: string | null;
    revocationNote: string | null;
  } | null;
  member: MemberSummary;
  otherRequests: {
    id: string;
    status: string;
    submittedAt: string;
    decidedAt: string | null;
  }[];
  history: HistoryEntry[];
};

export type LeadershipStatus =
  "pending" | "approved" | "rejected" | "cancelled";
export type LeadershipListItem = {
  id: string;
  memberId: string;
  name: string;
  email: string;
  status: LeadershipStatus;
  submittedAt: string;
  decidedAt: string | null;
  own: boolean;
  level: LeadershipLevel;
  committee: { id: string; name: string };
  team: { id: string; name: Localized; status: TeamSummary["status"] } | null;
  position: PositionSummary;
};

export type LeadershipDetail = {
  code: "SUCCESS";
  reviewer: "senior" | "reviewer" | "society_affairs";
  /** Whether the person may decide this request (leadership.review for its committee, ADR 0027). */
  canDecide: boolean;
  /** Whether the person may appoint in this committee (leadership.assign). */
  canAssign: boolean;
  own: boolean;
  stale: boolean;
  level: LeadershipLevel;
  request: {
    id: string;
    status: LeadershipStatus;
    submittedAt: string;
    decidedAt: string | null;
    decidedByEmail: string | null;
    rejectionReason: string | null;
    cancellationReason: string | null;
    reviewerNote: string | null;
    revision: number;
    committee: { id: string; name: string; archived: boolean };
    position: PositionSummary;
  };
  /** Null for committee-level leadership. */
  team:
    | (TeamSummary & {
        committee: { id: string; name: string; archived: boolean };
      })
    | null;
  holders: { appointmentId: string; memberId: string; name: string }[];
  maxHolders: number | null;
  appointment: {
    id: string;
    active: boolean;
    position: PositionSummary;
    revision: number;
    endedAt: string | null;
    endedByEmail: string | null;
    endReason: string | null;
    endNote: string | null;
  } | null;
  member: MemberSummary;
  memberAppointments: {
    id: string;
    committee: string;
    team: TeamSummary | null;
    position: PositionSummary;
  }[];
  history: HistoryEntry[];
};

/** An active appointment as committee management lists it, at committee or team level. */
export type LeaderRecord = {
  id: string;
  memberId: string;
  name: string;
  email: string;
  position: PositionSummary;
  appointedAt: string;
  source: "request" | "direct";
  revision: number;
};

export type TeamRecord = TeamSummary & {
  createdAt: string;
  updatedAt: string | null;
  archivedAt: string | null;
  pendingRequests: number;
  inUse: boolean;
  leaders: LeaderRecord[];
};
export type PositionRecord = PositionSummary & {
  maxHolders: number | null;
  requestable: boolean;
};

export type VerificationSettings = {
  code: "SUCCESS";
  /** ADR 0026: whether members may send new leadership requests. */
  leadershipRequestsOpen: boolean;
  squSubmissionsPer30Days: number;
  documentRetentionDays: number | null;
  leadershipRequestsPer30Days: number;
  maxActiveAppointmentsPerMember: number | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
  /** Whether the person may change these settings (settings.verification, ADR 0027). */
  canEdit?: boolean;
  /** maxHolders: per team; maxHoldersPerCommittee: at committee level (0035). Null: no limit. */
  positions: (PositionSummary & {
    maxHolders: number | null;
    maxHoldersPerCommittee?: number | null;
  })[];
};
