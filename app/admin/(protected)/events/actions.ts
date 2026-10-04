"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getManagerContext } from "@/lib/auth/manager";
import {
  writeAdminEvent,
  writeLifecycleEvent,
  type LifecycleOperation,
} from "@/lib/admin-events/server";
import { isUuid } from "@/lib/admin-events/types";

function one(form: FormData, key: string) {
  const values = form.getAll(key);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}

function muscatIso(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? `${value}:00+04:00`
    : value;
}

export async function saveEventAction(form: FormData) {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "AUTH_REQUIRED" };
  if (
    [
      "eventId",
      "committeeId",
      "revision",
      "title",
      "description",
      "eventDate",
      "location",
      "capacity",
    ].some((key) => form.getAll(key).length > 1)
  )
    return { code: "VALIDATION_ERROR" };
  const id = one(form, "eventId");
  const committeeId = one(form, "committeeId");
  const revisionValue = one(form, "revision");
  const revision = Number(revisionValue);
  const title = one(form, "title");
  const description = one(form, "description");
  const eventDate = muscatIso(one(form, "eventDate"));
  const location = one(form, "location");
  const capacityValue = one(form, "capacity");
  const capacity = capacityValue ? Number(capacityValue) : null;
  const edit = form.has("eventId");
  if (
    (edit && id === null) ||
    !title ||
    description === null ||
    !eventDate ||
    location === null ||
    (edit
      ? form.has("committeeId") ||
        revisionValue === null ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      : committeeId === null || form.has("revision")) ||
    (id !== null && !isUuid(id)) ||
    (committeeId !== null && !isUuid(committeeId)) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+04:00$/.test(eventDate) ||
    Number.isNaN(Date.parse(eventDate)) ||
    title.trim().length > 200 ||
    description.length > 10_000 ||
    location.length > 500 ||
    (capacityValue !== null &&
      capacityValue !== "" &&
      (!Number.isSafeInteger(capacity) || capacity! < 1))
  )
    return { code: "VALIDATION_ERROR" };
  const values = id
    ? [
        manager.userId,
        id,
        revision,
        title,
        description,
        eventDate,
        location,
        capacity,
      ]
    : [
        manager.userId,
        committeeId,
        title,
        description,
        eventDate,
        location,
        capacity,
      ];
  let result;
  try {
    result = await writeAdminEvent(id ? "edit_event" : "create_event", values);
  } catch {
    return { code: "SERVER_ERROR" };
  }
  if (result.code === "SUCCESS" && result.eventId)
    redirect(`/admin/events/${result.eventId}`);
  if (result.code === "SUCCESS" && id) revalidatePath(`/admin/events/${id}`);
  return result;
}

const lifecycleOperations = new Set<LifecycleOperation>([
  "flag_review",
  "unflag_review",
  "approve_event",
  "reject_review",
  "publish_event",
  "hold_event_full",
  "reopen_event",
  "archive_event",
  "restore_event",
]);

export async function lifecycleEventAction(_previous: unknown, form: FormData) {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "AUTH_REQUIRED" };
  const operation = one(form, "operation");
  if (
    (operation === "approve_event" || operation === "reject_review") &&
    manager.accessLevel === "COMMITTEE_MANAGER"
  )
    return { code: "GLOBAL_ACCESS_REQUIRED" };
  const eventId = one(form, "eventId");
  const revision = Number(one(form, "revision"));
  const note = one(form, "note");
  if (
    !operation ||
    !lifecycleOperations.has(operation as LifecycleOperation) ||
    !eventId ||
    !isUuid(eventId) ||
    !Number.isSafeInteger(revision) ||
    (operation === "reject_review" && (note === null || note.length > 200))
  )
    return { code: "VALIDATION_ERROR" };
  let result;
  try {
    result =
      operation === "reject_review"
        ? await writeLifecycleEvent(
            "reject_review",
            manager.userId,
            eventId,
            revision,
            note
          )
        : await writeLifecycleEvent(
            operation as LifecycleOperation,
            manager.userId,
            eventId,
            revision
          );
  } catch {
    return { code: "SERVER_ERROR" };
  }
  if (result.code === "SUCCESS") {
    revalidatePath(`/admin/events/${eventId}`);
    revalidatePath("/admin/events");
  }
  return result;
}
