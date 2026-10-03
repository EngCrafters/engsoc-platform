import type { ReactNode } from "react";
import Link from "next/link";
import { Check, KeyRound, LogOut, Wrench, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const managerCan = [
  "Create, edit, and publish events in your committees, subject to review.",
  "Approve a draft flagged by another manager in the same committee.",
  "View registrations and export event-scoped CSV files.",
];

const managerCannot = [
  "Manage a committee without an active grant.",
  "Grant, revoke, or change committee access, including your own.",
  "Delete events, alter audit history, or export platform-wide data.",
];

const maintenanceOnly = [
  "Provision accounts and committee-manager access.",
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
  idPrefix = "account",
}: {
  email: string | null;
  userId: string;
  committees: ReadonlyArray<{ id: string; name: string }>;
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
        description="Not a platform-wide owner or super-admin role."
      >
        <Badge variant="secondary">Committee manager</Badge>
      </SettingRow>
      <SettingRow
        title="Committee access"
        titleId={`${idPrefix}-scope-title`}
        description="Active grants, checked on every request. Revoked grants stop access immediately."
        className="@lg:items-start"
      >
        <ul
          data-testid="account-scopes"
          aria-labelledby={`${idPrefix}-scope-title`}
          className="flex w-full flex-col divide-y rounded-lg border @lg:w-64"
        >
          {committees.map((committee) => (
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
  idPrefix = "account",
}: {
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
        This committee manager account is not a platform-wide owner or
        super-admin role. The application has no such role.
      </p>
      <section aria-labelledby={`${idPrefix}-can-title`}>
        <h3 id={`${idPrefix}-can-title`} className="mb-3 text-sm font-medium">
          Committee managers can
        </h3>
        <ItemList items={managerCan} icon={Check} />
      </section>
      <section aria-labelledby={`${idPrefix}-cannot-title`}>
        <h3
          id={`${idPrefix}-cannot-title`}
          className="mb-3 text-sm font-medium"
        >
          Committee manager limits
        </h3>
        <ItemList items={managerCannot} icon={X} />
      </section>
      <section aria-labelledby={`${idPrefix}-maintenance-title`}>
        <h3
          id={`${idPrefix}-maintenance-title`}
          className="mb-3 text-sm font-medium"
        >
          Needs maintenance authority
        </h3>
        <ItemList items={maintenanceOnly} icon={Wrench} />
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Platform maintenance manages hosting and database accounts. They work
          outside this application; these controls cannot grant or change their
          access.
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
