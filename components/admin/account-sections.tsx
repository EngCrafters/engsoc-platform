import type { ReactNode } from "react";
import Link from "next/link";
import { Check, KeyRound, LogOut, Wrench, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AccessLevel } from "@/lib/auth/manager";

const managerCan = [
  "Create, edit, and publish events in your assigned committee, subject to review.",
  "View only your assigned committee's registrations and counts.",
  "View registrations and export event-scoped CSV files.",
];

const managerCannot = [
  "Manage another committee.",
  "Grant, revoke, or change committee access, including your own.",
  "Delete events, alter audit history, or export platform-wide data.",
];

const maintenanceOnly = [
  "Manage infrastructure accounts, secrets, RLS policies or migrations.",
  "Reset system passwords or change platform settings.",
  "Transfer operational ownership.",
];

/** One labelled setting: title and help text on the left, value or control on the right. */
export function SettingRow({
  title,
  description,
  children,
  className,
  titleId,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-6",
        className
      )}
    >
      <div className="min-w-0 @lg:max-w-sm">
        <p id={titleId} className="text-sm font-medium">
          {title}
        </p>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="min-w-0 @lg:flex @lg:justify-end">{children}</div>
      ) : null}
    </div>
  );
}

export function SettingRows({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("@container flex flex-col divide-y", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function ItemList({
  items,
  icon: Icon,
  label,
}: {
  items: string[];
  icon: typeof Check;
  label?: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm text-foreground/90">
          <Icon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function AccountProfileSection({
  email,
  userId,
  committees,
  accessLevel = "COMMITTEE_MANAGER",
  idPrefix = "account",
}: {
  email: string | null;
  userId: string;
  committees: ReadonlyArray<{ id: string; name: string }>;
  accessLevel?: AccessLevel;
  idPrefix?: string;
}) {
  return (
    <SettingRows role="region" aria-labelledby={`${idPrefix}-identity-title`}>
      <SettingRow
        title="Email"
        titleId={`${idPrefix}-identity-title`}
        description="Sign-in identity, separate from member profiles."
      >
        <p
          data-testid="account-email"
          className="break-all text-sm @lg:text-right"
        >
          {email ?? "No email on this account"}
        </p>
      </SettingRow>
      <SettingRow
        title="Role"
        description="Application access level, checked on every request."
      >
        <Badge variant="secondary">
          {accessLevel === "TECHNICAL"
            ? "Technical Team"
            : accessLevel === "BOARD_ADMIN"
              ? "Board Administration"
              : "Committee Manager"}
        </Badge>
      </SettingRow>
      <SettingRow
        title="Committee access"
        titleId={`${idPrefix}-scope-title`}
        description="Active scope, checked on every request. Revocation stops access immediately."
        className="@lg:items-start"
      >
        <ul
          data-testid="account-scopes"
          aria-labelledby={`${idPrefix}-scope-title`}
          className="flex w-full flex-col divide-y rounded-lg border @lg:w-64"
        >
          {(accessLevel === "COMMITTEE_MANAGER"
            ? committees
            : [{ id: "all", name: "All Committees" }]
          ).map((committee) => (
            <li
              key={committee.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">{committee.name}</span>
              <Badge variant="outline">Active</Badge>
            </li>
          ))}
        </ul>
      </SettingRow>
      <SettingRow title="Account ID">
        <p
          data-testid="account-user-id"
          className="break-all font-mono text-xs text-muted-foreground @lg:text-right"
        >
          {userId}
        </p>
      </SettingRow>
    </SettingRows>
  );
}

export function AccountPermissionsSection({
  accessLevel = "COMMITTEE_MANAGER",
  idPrefix = "account",
}: {
  accessLevel?: AccessLevel;
  idPrefix?: string;
}) {
  return (
    <div
      role="region"
      aria-labelledby={`${idPrefix}-role-title`}
      className="flex flex-col gap-6"
    >
      <p
        id={`${idPrefix}-role-title`}
        className="max-w-2xl text-sm text-muted-foreground"
      >
        {accessLevel === "TECHNICAL"
          ? "Technical Team has global application access and manages application roles. Infrastructure changes use the separate maintenance procedure."
          : accessLevel === "BOARD_ADMIN"
            ? "Board Administration has global operational access across committees and can review events. Access management and technical controls remain with the Technical Team."
            : "Committee Managers have one fixed committee scope. Board Administration or Technical Team reviews flagged events."}
      </p>
      <section aria-labelledby={`${idPrefix}-can-title`}>
        <h3 id={`${idPrefix}-can-title`} className="mb-3 text-sm font-medium">
          {accessLevel === "TECHNICAL"
            ? "Technical Team can"
            : accessLevel === "BOARD_ADMIN"
              ? "Board Administration can"
              : "Committee Managers can"}
        </h3>
        <ItemList
          items={
            accessLevel === "COMMITTEE_MANAGER"
              ? managerCan
              : accessLevel === "BOARD_ADMIN"
                ? [
                    "View and manage operational data across all committees.",
                    "Review flagged events from a different actor.",
                    "View global counts and export authorized registrations.",
                  ]
                : [
                    "View and manage all committee content.",
                    "Manage Committee Manager and Board Administration access.",
                    "Review flagged events from a different actor.",
                  ]
          }
          icon={Check}
        />
      </section>
      <section aria-labelledby={`${idPrefix}-cannot-title`}>
        <h3
          id={`${idPrefix}-cannot-title`}
          className="mb-3 text-sm font-medium"
        >
          {accessLevel === "COMMITTEE_MANAGER"
            ? "Committee Manager limits"
            : "Access limits"}
        </h3>
        <ItemList
          items={
            accessLevel === "COMMITTEE_MANAGER"
              ? managerCannot
              : accessLevel === "BOARD_ADMIN"
                ? [
                    "Manage application access or Technical Team membership.",
                    "Access infrastructure credentials, secrets, RLS or migrations.",
                  ]
                : [
                    "Grant Technical access from inside the application.",
                    "Change infrastructure credentials, RLS or migrations from this dashboard.",
                  ]
          }
          icon={X}
        />
      </section>
      <section aria-labelledby={`${idPrefix}-maintenance-title`}>
        <h3
          id={`${idPrefix}-maintenance-title`}
          className="mb-3 text-sm font-medium"
        >
          External maintenance
        </h3>
        <ItemList items={maintenanceOnly} icon={Wrench} />
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Platform maintenance manages hosting and database accounts outside
          this application.
        </p>
      </section>
    </div>
  );
}

export function AccountSecuritySection({
  logoutAction,
  idPrefix = "account",
}: {
  logoutAction: () => void | Promise<void>;
  idPrefix?: string;
}) {
  return (
    <SettingRows role="region" aria-labelledby={`${idPrefix}-security-title`}>
      <SettingRow
        title="Password"
        titleId={`${idPrefix}-security-title`}
        description="Recovery changes your sign-in password only. It never changes which committees you can manage."
      >
        <Button asChild variant="outline">
          <Link href="/admin/recovery">
            <KeyRound aria-hidden="true" data-icon="inline-start" />
            Reset password
          </Link>
        </Button>
      </SettingRow>
      <SettingRow
        title="Sign out"
        description="Use a unique password of at least 12 characters, and sign out on shared devices. If you lose inbox access or committee access changes, contact platform maintenance."
      >
        <form action={logoutAction}>
          <Button type="submit" variant="secondary">
            <LogOut aria-hidden="true" data-icon="inline-start" />
            Sign out
          </Button>
        </form>
      </SettingRow>
    </SettingRows>
  );
}
