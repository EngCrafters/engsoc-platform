"use server";

import { revalidatePath } from "next/cache";
import {
  formText,
  isUuid,
  requirePermission,
} from "@/lib/administration/access";
import {
  assignLeadership,
  createTeam,
  deleteTeam,
  moveTeam,
  setTeamStatus,
  updateAppointment,
  updateTeam,
} from "@/lib/administration/teams";
import { logServerError } from "@/lib/api/log";
import { verificationMessage } from "@/lib/verification/labels";
import type { AdminActionState } from "../../actions";

/**
 * Teams and direct appointments (ADR 0025). Teams: Board Administration and
 * Technical. Appointments: Board Administration only here (the leadership
 * reviewers; Society Affairs decides from the membership section). Every
 * routine re-checks that, holds the organization lock, and never touches
 * administrative access.
 */

const FORBIDDEN: AdminActionState = {
  status: "error",
  message: verificationMessage("FORBIDDEN"),
};
const INVALID: AdminActionState = {
  status: "error",
  message: verificationMessage("VALIDATION_ERROR"),
};
const POSITION = /^[a-z][a-z_]{1,39}$/;

const FIELD_MESSAGES: Record<string, string> = {
  nameEn: "Use an English name of 2–80 characters.",
  nameAr: "Use an Arabic name of 2–80 characters, or leave it empty.",
  descriptionEn: "Keep the English description under 1,000 characters.",
  descriptionAr: "Keep the Arabic description under 1,000 characters.",
  position: "Choose a position.",
  note: "Keep the internal note under 1,000 characters.",
};

function outcome(
  result: { code: string; field?: string; id?: unknown } & Record<
    string,
    unknown
  >,
  success: string
): AdminActionState {
  if (result.code === "SUCCESS")
    return {
      status: "success",
      message: success,
      id: typeof result.id === "string" ? result.id : undefined,
    };
  if (result.code === "BLOCKED" && Number(result.appointments) > 0)
    return {
      status: "error",
      message: `${result.appointments} active appointment${Number(result.appointments) === 1 ? "" : "s"} must be revoked first.`,
    };
  return {
    status: "error",
    message:
      result.code === "VALIDATION_ERROR" && result.field
        ? (FIELD_MESSAGES[result.field] ?? verificationMessage(result.code))
        : verificationMessage(result.code),
    field: result.field,
  };
}

async function guarded(
  committee: string,
  run: () => Promise<AdminActionState>,
  also: string[] = []
): Promise<AdminActionState> {
  try {
    const result = await run();
    if (result.status === "success") {
      revalidatePath(`/admin/administration/committees/${committee}`);
      for (const path of also) revalidatePath(path);
    }
    return result;
  } catch (error) {
    logServerError("team_action_failed", error);
    return {
      status: "error",
      message:
        "The change could not be confirmed. Refresh before trying again.",
    };
  }
}

const teamText = (form: FormData) => {
  const value = (name: string) => formText(form, name)?.trim() ?? "";
  return {
    nameEn: value("nameEn"),
    nameAr: value("nameAr") || null,
    descriptionEn: value("descriptionEn") || null,
    descriptionAr: value("descriptionAr") || null,
  };
};
const tooLong = (team: ReturnType<typeof teamText>) =>
  team.nameEn.length > 200 ||
  (team.nameAr?.length ?? 0) > 200 ||
  (team.descriptionEn?.length ?? 0) > 2000 ||
  (team.descriptionAr?.length ?? 0) > 2000;

export async function saveTeamAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const committee = formText(form, "committeeId");
  const team = formText(form, "teamId");
  const text = teamText(form);
  if (!isUuid(committee) || (team !== null && !isUuid(team)) || tooLong(text))
    return INVALID;
  // Teams are managed with teams.manage for their committee (ADR 0027); the routine re-checks it.
  const actor = await requirePermission("teams.manage", committee);
  if (!actor) return FORBIDDEN;
  return guarded(committee, async () =>
    team
      ? outcome(await updateTeam(actor.userId, team, text), "Team saved.")
      : outcome(
          await createTeam(actor.userId, committee, text),
          "Team created."
        )
  );
}

export async function moveTeamAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const committee = formText(form, "committeeId");
  const team = formText(form, "teamId");
  const target = formText(form, "targetCommitteeId");
  if (!isUuid(committee) || !isUuid(team) || !isUuid(target)) return INVALID;
  // Moving needs teams.manage for both committees.
  const actor = await requirePermission("teams.manage", committee);
  if (!actor || !(await requirePermission("teams.manage", target)))
    return FORBIDDEN;
  return guarded(committee, async () => {
    const result = await moveTeam(actor.userId, team, target);
    const closed = Number(result.cancelledRequests ?? 0);
    return outcome(
      result,
      closed
        ? `Team moved. ${closed} pending request${closed === 1 ? " was" : "s were"} closed; the members can request again.`
        : "Team moved. Its appointments moved with it."
    );
  }, [`/admin/administration/committees/${target}`]);
}

export async function teamStatusAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const committee = formText(form, "committeeId");
  const team = formText(form, "teamId");
  const status = formText(form, "status");
  if (
    !isUuid(committee) ||
    !isUuid(team) ||
    (status !== "active" && status !== "inactive" && status !== "archived")
  )
    return INVALID;
  const actor = await requirePermission("teams.manage", committee);
  if (!actor) return FORBIDDEN;
  return guarded(committee, async () => {
    const result = await setTeamStatus(actor.userId, team, status);
    const closed = Number(result.cancelledRequests ?? 0);
    const base =
      status === "active"
        ? "Team activated."
        : status === "inactive"
          ? "Team deactivated. It takes no requests or appointments."
          : "Team archived. Its history stays.";
    return outcome(
      result,
      closed
        ? `${base} ${closed} pending request${closed === 1 ? " was" : "s were"} closed.`
        : base
    );
  });
}

export async function deleteTeamAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const committee = formText(form, "committeeId");
  const team = formText(form, "teamId");
  if (!isUuid(committee) || !isUuid(team)) return INVALID;
  const actor = await requirePermission("teams.manage", committee);
  if (!actor) return FORBIDDEN;
  return guarded(committee, async () =>
    outcome(await deleteTeam(actor.userId, team), "Team deleted.")
  );
}

export async function assignLeaderAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const committee = formText(form, "committeeId");
  // ADR 0026: no team means a committee-level appointment.
  const team = formText(form, "teamId") || null;
  const member = formText(form, "memberId");
  const position = formText(form, "position");
  const note = formText(form, "note")?.trim() || null;
  if (
    !isUuid(committee) ||
    (team !== null && !isUuid(team)) ||
    !isUuid(member) ||
    !position ||
    !POSITION.test(position) ||
    (note?.length ?? 0) > 1000
  )
    return INVALID;
  // Direct appointments need leadership.assign for the committee (ADR 0027).
  const actor = await requirePermission("leadership.assign", committee);
  if (!actor) return FORBIDDEN;
  return guarded(
    committee,
    async () =>
      outcome(
        await assignLeadership(
          actor.userId,
          member,
          committee,
          team,
          position,
          note
        ),
        "Appointment recorded. Dashboard access follows the permissions assigned to this committee or team."
      ),
    ["/admin/membership/leadership"]
  );
}

export async function changeLeaderPositionAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const committee = formText(form, "committeeId");
  const appointment = formText(form, "appointmentId");
  const position = formText(form, "position");
  const revision = Number(formText(form, "revision"));
  if (
    !isUuid(committee) ||
    !isUuid(appointment) ||
    !position ||
    !POSITION.test(position) ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    return INVALID;
  // Changing an appointment is a leadership decision for its committee.
  const actor = await requirePermission("leadership.review", committee);
  if (!actor) return FORBIDDEN;
  return guarded(
    committee,
    async () =>
      outcome(
        await updateAppointment(
          actor.userId,
          appointment,
          revision,
          position,
          null
        ),
        "Position changed."
      ),
    ["/admin/membership/leadership"]
  );
}
