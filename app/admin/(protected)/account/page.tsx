import type { Metadata } from "next";
import { AccountOverview } from "@/components/admin/account-overview";
import { getManagerContext } from "@/lib/auth/manager";
import { logoutAction } from "../../actions";

export const metadata: Metadata = { title: "Account & security" };

export default async function AdminAccountPage() {
  // The protected layout already resolves and gates the manager context; the
  // request-cached lookup is reused here, not repeated.
  const manager = await getManagerContext();
  if (manager.kind !== "manager") return null;

  return (
    <AccountOverview
      email={manager.email}
      userId={manager.userId}
      committees={manager.committees}
      logoutAction={logoutAction}
    />
  );
}
