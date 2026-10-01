import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { logoutAction } from "../actions";
import { AdminShell } from "@/components/admin/admin-shell";
import { NoAccessState } from "@/components/admin/no-access-state";
import { getManagerContext } from "@/lib/auth/manager";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const manager = await getManagerContext();
  if (manager.kind === "anonymous") redirect("/admin/login?next=/admin/events");

  if (manager.kind === "unassigned") {
    return <NoAccessState email={manager.email} logoutAction={logoutAction} />;
  }

  return (
    <AdminShell
      email={manager.email}
      userId={manager.userId}
      committees={manager.committees}
      logoutAction={logoutAction}
    >
      {children}
    </AdminShell>
  );
}
