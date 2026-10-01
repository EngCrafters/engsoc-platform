import type { ReactNode } from "react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminMotionConfig } from "@/components/admin/admin-motion-config";

export function AdminShell({
  email,
  committees,
  logoutAction,
  children,
}: {
  email: string | null;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <AdminMotionConfig>
      <div className="min-h-screen bg-background text-foreground lg:flex">
        <AdminSidebar
          email={email}
          committees={committees}
          logoutAction={logoutAction}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminMobileNav
            email={email}
            committees={committees}
            logoutAction={logoutAction}
          />
          <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </AdminMotionConfig>
  );
}
