"use server";

import { revalidatePath } from "next/cache";
import {
  changeCommitteeMember,
  createCommittee,
  listMembers,
  setAccessSuspension,
  setCommitteeArchived,
  updateCommittee,
  type MemberRow,
} from "@/lib/administration/server";
import { formText, isUuid, requireSenior } from "@/lib/administration/access";
import { administrationMessage } from "@/lib/administration/messages";
import { logServerError } from "@/lib/api/log";

export type AdminActionState =
  | { status: "idle" }
  | { status: "success"; message: string; id?: string }
  | { status: "error"; message: string; field?: string };

const FORBIDDEN: AdminActionState = {
  status: "error",
  message: administrationMessage("FORBIDDEN"),
};

function outcome(
  result: { code: string; field?: string; id?: unknown },
  success: string
): AdminActionState {
  if (result.code === "SUCCESS")
    return {
      status: "success",
      message: success,
      id: typeof result.id === "string" ? result.id : undefined,
    };
  return {
    status: "error",
    message:
      result.code === "VALIDATION_ERROR" && result.field
        ? (FIELD_MESSAGES[result.field] ?? administrationMessage(result.code))
        : administrationMessage(result.code),
    field: result.field,
  };
}

const FIELD_MESSAGES: Record<string, string> = {
  name: "Use a name of 2–80 characters.",
  slug: "Use 2–40 lowercase letters, digits and single hyphens, for example media-team.",
  description: "Keep the description under 1,000 characters.",
  responsibility: "Keep the responsibility under 120 characters.",
};

async function guarded(
  run: () => Promise<AdminActionState>
): Promise<AdminActionState> {
  try {
    return await run();
  } catch (error) {
    logServerError("administration_action_failed", error);
    return {
      status: "error",
      message:
        "The change could not be confirmed. Refresh before trying again.",
    };
  }
}

export async function createCommitteeAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const actor = await requireSenior();
  if (!actor) return FORBIDDEN;
  const name = formText(form, "name") ?? "";
  const slug = formText(form, "slug") ?? "";
  const description = formText(form, "description");
  if (
    name.length > 200 ||
    slug.length > 100 ||
    (description?.length ?? 0) > 2000
  )
    return {
      status: "error",
      message: administrationMessage("VALIDATION_ERROR"),
    };
  return guarded(async () => {
    const result = await createCommittee(actor.userId, {
      name,
      slug,
      description: description || null,
    });
    if (result.code === "SUCCESS") revalidatePath("/admin", "layout");
    return outcome(result, "Committee created.");
  });
}

export async function updateCommitteeAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const actor = await requireSenior();
  if (!actor) return FORBIDDEN;
  const id = formText(form, "committeeId");
  const name = formText(form, "name") ?? "";
  const description = formText(form, "description");
  if (!isUuid(id) || name.length > 200 || (description?.length ?? 0) > 2000)
    return {
      status: "error",
      message: administrationMessage("VALIDATION_ERROR"),
    };
  return guarded(async () => {
    const result = await updateCommittee(actor.userId, id, {
      name,
      description: description || null,
    });
    if (result.code === "SUCCESS") revalidatePath("/admin", "layout");
    return outcome(result, "Committee details saved.");
  });
}

export async function archiveCommitteeAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const actor = await requireSenior();
  if (!actor) return FORBIDDEN;
  const id = formText(form, "committeeId");
  const archived = formText(form, "archived");
  if (!isUuid(id) || (archived !== "true" && archived !== "false"))
    return {
      status: "error",
      message: administrationMessage("VALIDATION_ERROR"),
    };
  return guarded(async () => {
    const result = await setCommitteeArchived(
      actor.userId,
      id,
      archived === "true"
    );
    if (result.code === "BLOCKED") {
      const managers = Number(result.managers ?? 0);
      const upcoming = Number(result.upcomingEvents ?? 0);
      return {
        status: "error",
        message: [
          managers
            ? `${managers} active manager${managers === 1 ? "" : "s"} must be revoked or reassigned first.`
            : "",
          upcoming
            ? `${upcoming} upcoming live event${upcoming === 1 ? "" : "s"} must be archived first.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
    if (result.code === "SUCCESS") revalidatePath("/admin", "layout");
    return outcome(
      result,
      archived === "true"
        ? "Committee archived. Its records stay; it accepts no new events or managers."
        : "Committee restored."
    );
  });
}

export async function rosterAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const actor = await requireSenior();
  if (!actor) return FORBIDDEN;
  const committee = formText(form, "committeeId");
  const member = formText(form, "memberId");
  const operation = formText(form, "operation");
  const responsibility = formText(form, "responsibility");
  if (
    !isUuid(committee) ||
    !isUuid(member) ||
    (operation !== "add" && operation !== "update" && operation !== "remove") ||
    (responsibility?.length ?? 0) > 300
  )
    return {
      status: "error",
      message: administrationMessage("VALIDATION_ERROR"),
    };
  return guarded(async () => {
    const result = await changeCommitteeMember(
      actor.userId,
      committee,
      member,
      operation,
      responsibility || null
    );
    if (result.code === "SUCCESS")
      revalidatePath(`/admin/administration/committees/${committee}`);
    return outcome(
      result,
      operation === "add"
        ? "Member added to the committee."
        : operation === "update"
          ? "Responsibility saved."
          : "Member removed from the committee."
    );
  });
}

/** Members matching a search, for adding to a committee roster. */
export async function searchMembersAction(
  query: string
): Promise<
  { id: string; name: string; email: string; universityId: string }[]
> {
  const actor = await requireSenior();
  if (
    !actor ||
    typeof query !== "string" ||
    query.trim().length < 2 ||
    query.length > 100
  )
    return [];
  try {
    const result = await listMembers(actor.userId, query.trim(), "all", 0);
    return ((result.members as MemberRow[] | undefined) ?? [])
      .slice(0, 8)
      .map(({ id, name, email, universityId }) => ({
        id,
        name,
        email,
        universityId,
      }));
  } catch (error) {
    logServerError("administration_member_search_failed", error);
    return [];
  }
}

export async function accessSuspensionAction(
  _previous: AdminActionState,
  form: FormData
): Promise<AdminActionState> {
  const actor = await requireSenior();
  if (!actor) return FORBIDDEN;
  const user = formText(form, "userId");
  const suspend = formText(form, "suspend");
  const note = formText(form, "note");
  if (
    !isUuid(user) ||
    (suspend !== "true" && suspend !== "false") ||
    (note?.length ?? 0) > 200
  )
    return {
      status: "error",
      message: administrationMessage("VALIDATION_ERROR"),
    };
  return guarded(async () => {
    const result = await setAccessSuspension(
      actor.userId,
      user,
      suspend === "true",
      note || null
    );
    if (result.code === "SUCCESS") revalidatePath("/admin", "layout");
    return outcome(
      result,
      suspend === "true"
        ? "Access suspended. It ends on the account's next request and can be reactivated."
        : "Access reactivated with its former role and committee."
    );
  });
}
