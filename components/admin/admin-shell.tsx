"use client";

import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminPreferencesProvider } from "@/components/admin/preferences";
import {
  AdminSidebar,
  type MembershipNavigation,
} from "@/components/admin/admin-sidebar";
import type { AccessLevel } from "@/lib/auth/manager";
import {
  SettingsDialog,
  type SettingsSection,
} from "@/components/settings-dialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AdminShell({
  email,
  userId,
  accessLevel,
  committees,
  membership = null,
  logoutAction,
  children,
}: {
  email: string | null;
  userId: string;
  accessLevel: AccessLevel;
  committees: ReadonlyArray<{ id: string; name: string }>;
  membership?: MembershipNavigation | null;
  logoutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("appearance");
  const settingsTrigger = useRef<HTMLElement | null>(null);

  function openSettings(trigger: HTMLElement) {
    settingsTrigger.current = trigger;
    setSettingsSection("appearance");
    setSettingsOpen(true);
  }

  return (
    <AdminPreferencesProvider>
      {({ density, motion }) => (
        <SidebarProvider
          data-density={density}
          data-motion={motion}
          className="group/admin"
          style={
            {
              "--sidebar-width": "calc(var(--spacing) * 72)",
              "--header-height": "calc(var(--spacing) * 12)",
            } as CSSProperties
          }
        >
          <AdminSidebar
            variant="inset"
            email={email}
            accessLevel={accessLevel}
            committees={committees}
            membership={membership}
            logoutAction={logoutAction}
            onOpenSettings={openSettings}
          />
          <SidebarInset>
            <AdminHeader />
            <div className="@container/main flex flex-1 flex-col">
              <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:py-6 lg:px-6">
                {children}
              </div>
            </div>
          </SidebarInset>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            section={settingsSection}
            onSectionChange={setSettingsSection}
            restoreFocus={() => settingsTrigger.current?.focus()}
            email={email}
            userId={userId}
            accessLevel={accessLevel}
            committees={committees}
            logoutAction={logoutAction}
          />
        </SidebarProvider>
      )}
    </AdminPreferencesProvider>
  );
}
