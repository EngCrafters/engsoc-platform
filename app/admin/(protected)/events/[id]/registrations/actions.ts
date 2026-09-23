"use server";

import { revalidatePath } from "next/cache";
import { getManagerContext } from "@/lib/auth/manager";
import { promoteWaitlist } from "@/lib/admin-registrations/server";
import { isUuid } from "@/lib/admin-registrations/types";

export async function promoteWaitlistAction(
  _previous: unknown,
  form: FormData
) {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "AUTH_REQUIRED" };
  const eventId = form.get("eventId");
  const registrationId = form.get("registrationId");
  if (
    typeof eventId !== "string" ||
    typeof registrationId !== "string" ||
    !isUuid(eventId) ||
    !isUuid(registrationId)
  )
    return { code: "VALIDATION_ERROR" };
  try {
    const result = await promoteWaitlist(
      manager.userId,
      eventId,
      registrationId
    );
    if (result.code === "SUCCESS")
      revalidatePath(`/admin/events/${eventId}/registrations`);
    return result;
  } catch {
    return { code: "SERVER_ERROR" };
  }
}
