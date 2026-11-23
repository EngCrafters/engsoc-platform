"use server";
import { getManagerContext } from "@/lib/auth/manager";
import { can } from "@/lib/auth/permissions";
import { writeProject } from "@/lib/projects/server";
import { UUID } from "@/lib/projects/content";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function reviewProject(
  _previous: { code: string },
  form: FormData
): Promise<{ code: string }> {
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return { code: "FORBIDDEN" };
  // Publishing needs projects.publish, every other decision projects.review (ADR 0027); the
  // routine checks the same.
  const operation = String(form.get("operation"));
  if (
    !can(
      manager,
      operation === "publish" || operation === "unpublish"
        ? "projects.publish"
        : "projects.review"
    )
  )
    return { code: "FORBIDDEN" };
  const id = String(form.get("id"));
  if (!UUID.test(id)) return { code: "NOT_FOUND" };
  let code = "UNAVAILABLE";
  try {
    code = (
      await writeProject(
        manager.userId,
        id,
        Number(form.get("revision")),
        String(form.get("operation")),
        null,
        String(form.get("feedback") ?? "").trim() || null,
        form.get("attest") === "on"
      )
    ).code;
  } catch {}
  revalidatePath("/admin/projects");
  revalidatePath(`/admin/projects/${id}`);
  if (code !== "SUCCESS") return { code };
  redirect(`/admin/projects/${id}?result=${encodeURIComponent(code)}`);
}
