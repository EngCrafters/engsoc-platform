import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { logoutAction } from "../actions";
import { AdminShell } from "@/components/admin/admin-shell";
import { NoAccessState } from "@/components/admin/no-access-state";
import { getManagerContext } from "@/lib/auth/manager";
import { accountAccessView } from "@/lib/auth/permissions";
import { dashboardNav } from "@/components/admin/admin-navigation";
import type { ManagerContext } from "@/lib/auth/manager";
import { hasMembershipReviewerRole } from "@/lib/membership/access";
import { getMembershipAccess } from "@/lib/membership/server";

/**
 * The membership section follows the person's permissions (ADR 0027): each
 * queue is shown to holders of its permission, as the database confirms.
 * When the database cannot answer (for example before migration 0025 is
 * applied), those roles see the section marked as needing setup, which opens
 * an explanation and nothing else; other managers still see nothing, the rest
 * of the dashboard works, and the server logs why.
 */
async function membershipNavigation(
  manager: Extract<ManagerContext, { kind: "manager" }>
) {
  const access = await getMembershipAccess(manager.userId);
  if (access.kind === "reviewer") {
    const { counts } = access.overview;
    return {
      awaiting: counts.pending_review + counts.verified,
      squPending: counts.squPending ?? 0,
      leadershipPending: counts.leadershipPending ?? 0,
    };
  }
  if (access.kind === "unavailable" && hasMembershipReviewerRole(manager)) {
    return { unavailable: access.reason };
  }
  return null;
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

  const membership = await membershipNavigation(manager);

  return (
    <AdminShell
      email={manager.email}
      userId={manager.userId}
      nav={dashboardNav(manager)}
      view={accountAccessView(manager)}
      membership={membership}
      logoutAction={logoutAction}
    >
      {children}
    </AdminShell>
  );
}
