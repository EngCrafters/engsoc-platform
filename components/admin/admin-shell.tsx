"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { AdminMotionConfig } from "@/components/admin/admin-motion-config";
import {
  SettingsDialog,
  type SettingsSection,
} from "@/components/settings-dialog";

export function AdminShell({
  email,
  userId,
  committees,
  logoutAction,
  children,
}: {
  email: string | null;
  userId: string;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("account");
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);

  function openSettings(trigger: HTMLButtonElement) {
    settingsTrigger.current = trigger;
    setSettingsSection("account");
    setSettingsOpen(true);
  }

  return (
    <AdminMotionConfig>
      <div className="min-h-screen bg-background text-foreground lg:flex">
        <AdminSidebar
          email={email}
          committees={committees}
          logoutAction={logoutAction}
          onOpenSettings={openSettings}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminMobileNav
            email={email}
            committees={committees}
            logoutAction={logoutAction}
            onOpenSettings={openSettings}
          />
          <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        restoreFocus={() => settingsTrigger.current?.focus()}
        email={email}
        userId={userId}
        committees={committees}
        logoutAction={logoutAction}
      />
    </AdminMotionConfig>
  );
}
