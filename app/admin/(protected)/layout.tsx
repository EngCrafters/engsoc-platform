import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { logoutAction } from "../actions";
import { AdminShell } from "@/components/admin/admin-shell";
import { NoAccessState } from "@/components/admin/no-access-state";
import { getManagerContext } from "@/lib/auth/manager";
import { getMembershipOverview } from "@/lib/membership/server";

/**
 * Membership review is a separate authority (ADR 0017): only Society Affairs
 * managers and Senior Management see the section. A failure here (for example
 * before migration 0025 is applied) hides the section instead of breaking the
 * rest of the dashboard.
 */
async function membershipNavigation(userId: string) {
  try {
    const overview = await getMembershipOverview(userId);
    return overview
      ? { awaiting: overview.counts.pending_review + overview.counts.verified }
      : null;
  } catch {
    return null;
  }
}

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

  const membership = await membershipNavigation(manager.userId);

  return (
    <AdminShell
      email={manager.email}
      userId={manager.userId}
      accessLevel={manager.accessLevel}
      committees={manager.committees}
      membership={membership}
      logoutAction={logoutAction}
    >
      {children}
    </AdminShell>
  );
}
