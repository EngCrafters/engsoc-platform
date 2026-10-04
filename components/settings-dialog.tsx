"use client";

import type { ComponentType } from "react";
import {
  CircleUserRound,
  Monitor,
  Moon,
  Paintbrush,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  AccountProfileSection,
  AccountSecuritySection,
  SettingRow,
  SettingRows,
} from "@/components/admin/account-sections";
import {
  useAdminPreferences,
  type Density,
  type MotionPreference,
} from "@/components/admin/preferences";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const choice =
  "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

export type SettingsSection = "appearance" | "account" | "security";

const sections: ReadonlyArray<{
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  { id: "appearance", label: "Appearance", icon: Paintbrush },
  { id: "account", label: "Account", icon: CircleUserRound },
  { id: "security", label: "Security", icon: ShieldCheck },
];

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const {
    preferences: { density, motion },
    setPreference,
  } = useAdminPreferences();

  return (
    <SettingRows>
      <SettingRow
        title="Theme"
        description="Choose how the workspace looks, or follow your device."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Theme"
          value={theme ?? "system"}
          onValueChange={(value) => value && setTheme(value)}
        >
          <ToggleGroupItem className={choice} value="light">
            <Sun aria-hidden="true" />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem className={choice} value="dark">
            <Moon aria-hidden="true" />
            Dark
          </ToggleGroupItem>
          <ToggleGroupItem className={choice} value="system">
            <Monitor aria-hidden="true" />
            System
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow
        title="Density"
        description="Compact tightens the row height in tables and lists."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Density"
          value={density}
          onValueChange={(value) =>
            value && setPreference("density", value as Density)
          }
        >
          <ToggleGroupItem className={choice} value="comfortable">
            Comfortable
          </ToggleGroupItem>
          <ToggleGroupItem className={choice} value="compact">
            Compact
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow
        title="Motion"
        description="Reduced removes transitions, in addition to your device setting."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Motion"
          value={motion}
          onValueChange={(value) =>
            value && setPreference("motion", value as MotionPreference)
          }
        >
          <ToggleGroupItem className={choice} value="enabled">
            Enabled
          </ToggleGroupItem>
          <ToggleGroupItem className={choice} value="reduced">
            Reduced
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <p className="pt-4 text-xs text-muted-foreground">
        Appearance settings apply instantly and are saved on this device only.
      </p>
    </SettingRows>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  restoreFocus,
  email,
  userId,
  accessLevel = "COMMITTEE_MANAGER",
  committees,
  logoutAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  restoreFocus: () => void;
  email: string | null;
  userId: string;
  accessLevel?: import("@/lib/auth/manager").AccessLevel;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
}) {
  const current = sections.find((item) => item.id === section) ?? sections[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
        className="flex flex-col gap-0 overflow-hidden p-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:h-[34rem] md:max-w-3xl"
      >
        <DialogHeader className="shrink-0 gap-1 border-b px-4 py-4 pr-12 md:px-6">
          <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
          <DialogDescription>
            Manage your dashboard preferences.
          </DialogDescription>
        </DialogHeader>
        <SidebarProvider className="min-h-0 flex-1 items-stretch">
          <Sidebar
            collapsible="none"
            className="hidden border-r md:flex"
            aria-label="Settings sections"
          >
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {sections.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === section}
                          aria-current={
                            item.id === section ? "page" : undefined
                          }
                          onClick={() => onSectionChange(item.id)}
                        >
                          <item.icon aria-hidden={true} />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <nav
              aria-label="Settings sections"
              className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2 md:hidden"
            >
              {sections.map((item) => (
                <Button
                  key={item.id}
                  variant={item.id === section ? "secondary" : "ghost"}
                  size="sm"
                  aria-current={item.id === section ? "page" : undefined}
                  onClick={() => onSectionChange(item.id)}
                  className="shrink-0"
                >
                  <item.icon aria-hidden={true} />
                  {item.label}
                </Button>
              ))}
            </nav>
            <header className="hidden h-12 shrink-0 items-center px-6 md:flex">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>Settings</BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{current.label}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </header>
            <div className="flex-1 overflow-y-auto p-4 md:px-6 md:pt-2 md:pb-6">
              {section === "appearance" ? <AppearanceSettings /> : null}
              {section === "account" ? (
                <AccountProfileSection
                  idPrefix="settings-account"
                  email={email}
                  userId={userId}
                  accessLevel={accessLevel}
                  committees={committees}
                />
              ) : null}
              {section === "security" ? (
                <AccountSecuritySection
                  idPrefix="settings-account"
                  logoutAction={logoutAction}
                />
              ) : null}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
