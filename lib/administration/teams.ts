import "server-only";

import {
  assignLeadershipThroughRoutine,
  createTeamThroughRoutine,
  deleteTeamThroughRoutine,
  moveTeamThroughRoutine,
  setTeamStatusThroughRoutine,
  teamsThroughRoutine,
  updateAppointmentThroughRoutine,
  updateTeamThroughRoutine,
  type TeamText,
} from "@/lib/verification/db";
import type {
  LeaderRecord,
  PositionRecord,
  TeamRecord,
} from "@/lib/verification/types";

/**
 * A committee's leaders and teams (ADRs 0025 and 0026): Engineering Society →
 * committee → appointment, or committee → team → appointment. Committee-level
 * leaders belong to the committee itself, with no team. Board Administration
 * and Technical manage teams; leadership reviewers appoint. Every
 * routine re-checks that and holds the organization lock, so occupancy limits
 * and team moves never interleave. Nothing here touches administrative access.
 */
export type { TeamText };

export async function committeeTeams(
  actor: string,
  committee: string
): Promise<{
  committeeLeaders: LeaderRecord[];
  committeePendingRequests: number;
  teams: TeamRecord[];
  positions: PositionRecord[];
} | null> {
  const result = await teamsThroughRoutine(actor, committee);
  if (result.code !== "SUCCESS") return null;
  return {
    committeeLeaders: (result.committeeLeaders ?? []) as LeaderRecord[],
    committeePendingRequests: Number(result.committeePendingRequests ?? 0),
    teams: result.teams as TeamRecord[],
    positions: result.positions as PositionRecord[],
  };
}

export const createTeam = (actor: string, committee: string, team: TeamText) =>
  createTeamThroughRoutine(actor, committee, team);

export const updateTeam = (actor: string, teamId: string, team: TeamText) =>
  updateTeamThroughRoutine(actor, teamId, team);

export const moveTeam = (actor: string, team: string, committee: string) =>
  moveTeamThroughRoutine(actor, team, committee);

export const setTeamStatus = (
  actor: string,
  team: string,
  status: "active" | "inactive" | "archived"
) => setTeamStatusThroughRoutine(actor, team, status);

export const deleteTeam = (actor: string, team: string) =>
  deleteTeamThroughRoutine(actor, team);

/** At committee level when `team` is null; the routine re-checks everything. */
export const assignLeadership = (
  actor: string,
  member: string,
  committee: string,
  team: string | null,
  position: string,
  note: string | null
) =>
  assignLeadershipThroughRoutine(
    actor,
    member,
    committee,
    team,
    position,
    note
  );

export const updateAppointment = (
  actor: string,
  appointment: string,
  revision: number,
  position: string,
  note: string | null
) =>
  updateAppointmentThroughRoutine(actor, appointment, revision, position, note);
