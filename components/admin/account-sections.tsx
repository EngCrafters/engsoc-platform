import type { ReactNode } from "react";
import Link from "next/link";
import { Check, KeyRound, LogOut, Wrench } from "lucide-react";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/callback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AccountAccessView } from "@/lib/auth/permissions";

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
  view,
  idPrefix = "account",
}: {
  email: string | null;
  userId: string;
  view: AccountAccessView;
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
        title="Access"
        description="Where your dashboard access comes from, checked on every request."
      >
        <Badge variant="secondary" className="max-w-full whitespace-normal">
          {view.roleLabel}
        </Badge>
      </SettingRow>
      <SettingRow
        title="Sources"
        titleId={`${idPrefix}-scope-title`}
        description="A personal access level, and each active Chief or Assistant Chief appointment with the permissions its committee or team grants. Revocation stops access on the next request."
        className="@lg:items-start"
      >
        <ul
          data-testid="account-scopes"
          aria-labelledby={`${idPrefix}-scope-title`}
          className="flex w-full flex-col divide-y rounded-lg border @lg:w-72"
        >
          {view.level ? (
            <li className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 text-sm">{view.level}</span>
              <Badge variant="outline">Personal level</Badge>
            </li>
          ) : null}
          {view.appointments.map((line) => (
            <li key={line} className="px-3 py-2 text-sm">
              {line}
            </li>
          ))}
          {!view.level && view.appointments.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No source of dashboard access.
            </li>
          ) : null}
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

/** Every permission the person holds now, by area, with its scope (ADR 0027). */
export function AccountPermissionsSection({
  view,
  idPrefix = "account",
}: {
  view: AccountAccessView;
  idPrefix?: string;
}) {
  const areas = [...new Set(view.permissions.map((p) => p.area))];
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
        Your permissions come from your personal access level and from the
        permissions assigned to the committees and teams you lead. The database
        checks each one on every action; this list is what it currently allows.
      </p>
      {areas.length === 0 ? (
        <p className="text-sm">No dashboard permissions.</p>
      ) : (
        areas.map((area) => (
          <section key={area} aria-label={area}>
            <h3 className="mb-3 text-sm font-medium">{area}</h3>
            <ul className="flex flex-col gap-2">
              {view.permissions
                .filter((p) => p.area === area)
                .map((p) => (
                  <li
                    key={p.key}
                    className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm text-foreground/90"
                  >
                    <Check
                      aria-hidden="true"
                      className="size-4 shrink-0 translate-y-0.5 text-muted-foreground"
                    />
                    <span>{p.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.scope}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
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
        description="Recovery changes your sign-in password only. It never changes your permissions."
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
        description={`Use a unique password of at least ${MIN_PASSWORD_LENGTH} characters, and sign out on shared devices. If you lose inbox access, contact platform maintenance.`}
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
