"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsUpDown,
  CircleUserRound,
  Layers3,
  LogOut,
  Monitor,
  Moon,
  Settings2,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  adminNavigation,
  isAdminNavActive,
} from "@/components/admin/admin-navigation";

type Committees = ReadonlyArray<{ id: string; name: string }>;
type OpenSettings = (trigger: HTMLElement) => void;

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: (typeof adminNavigation.workspace)[number]["icon"];
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const active = isAdminNavActive(pathname, href);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          onClick={() => setOpenMobile(false)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SettingsButton({ onOpenSettings }: { onOpenSettings: OpenSettings }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Settings"
        aria-haspopup="dialog"
        onClick={(event) => {
          const trigger = event.currentTarget;
          setOpenMobile(false);
          onOpenSettings(trigger);
        }}
      >
        <Settings2 aria-hidden="true" />
        <span>Settings</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AccountMenu({
  email,
  logoutAction,
  onOpenSettings,
}: {
  email: string | null;
  logoutAction: () => void | Promise<void>;
  onOpenSettings: OpenSettings;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const logoutForm = useRef<HTMLFormElement>(null);
  const identity = email ?? "Signed in";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              ref={triggerRef}
              size="lg"
              aria-label="Account menu"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">
                  {identity.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium" title={identity}>
                  {identity}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Committee manager
                </span>
              </div>
              <ChevronsUpDown
                aria-hidden="true"
                className="ml-auto size-4 text-muted-foreground"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">
                {identity}
              </span>
              <span className="block text-xs text-muted-foreground">
                Committee manager
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link
                  href="/admin/account"
                  onClick={() => setOpenMobile(false)}
                >
                  <CircleUserRound aria-hidden="true" />
                  Account
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setOpenMobile(false);
                  if (triggerRef.current) onOpenSettings(triggerRef.current);
                }}
              >
                <Settings2 aria-hidden="true" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Theme
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme ?? "system"}
              onValueChange={setTheme}
            >
              <DropdownMenuRadioItem value="light">
                <Sun aria-hidden="true" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon aria-hidden="true" />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor aria-hidden="true" />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => logoutForm.current?.requestSubmit()}
            >
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <form ref={logoutForm} action={logoutAction} className="hidden" />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AdminSidebar({
  email,
  committees,
  logoutAction,
  onOpenSettings,
  ...props
}: {
  email: string | null;
  committees: Committees;
  logoutAction: () => void | Promise<void>;
  onOpenSettings: OpenSettings;
} & Omit<React.ComponentProps<typeof Sidebar>, "children">) {
  const scopeLabel = committees.map((committee) => committee.name).join(", ");

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/admin/events">
                <BrandMark size={32} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    Engineering Society
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    Committee workspace
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Administration">
              {adminNavigation.workspace.map((link) => (
                <NavLink key={link.href} {...link} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Account">
              {adminNavigation.account.map((link) => (
                <NavLink key={link.href} {...link} />
              ))}
              <SettingsButton onOpenSettings={onOpenSettings} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {committees.length > 0 ? (
          <p
            role="note"
            aria-label={`Committee scope: ${scopeLabel}`}
            title={scopeLabel}
            className="flex items-center gap-2 px-2 text-xs text-muted-foreground"
          >
            <Layers3 aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0 truncate">
              Scope: {committees[0].name}
              {committees.length > 1 ? ` +${committees.length - 1}` : ""}
            </span>
          </p>
        ) : null}
        <AccountMenu
          email={email}
          logoutAction={logoutAction}
          onOpenSettings={onOpenSettings}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
