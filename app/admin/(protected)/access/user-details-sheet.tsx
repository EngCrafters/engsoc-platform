"use client";

import { useEffect, useState } from "react";
import { KeyRound, Mail, ShieldPlus, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserHistoryAction, type UserHistoryItem } from "./user-actions";
import {
  accessStatus,
  authStatus,
  formatWhen,
  roleLabel,
  scopeLabel,
  type UserRecord,
} from "./user-types";

export type DetailAction =
  | "assign"
  | "reassign"
  | "replace"
  | "revoke"
  | "reset"
  | "resend"
  | "password";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

/** Identity, application access, security actions and history for one account. */
export function UserDetailsSheet({
  user,
  isSelf,
  canAdminister,
  onClose,
  onAction,
}: {
  user: UserRecord | null;
  isSelf: boolean;
  canAdminister: boolean;
  onClose: () => void;
  onAction: (action: DetailAction, user: UserRecord) => void;
}) {
  const [history, setHistory] = useState<{
    userId: string;
    items: UserHistoryItem[];
    failed?: boolean;
  } | null>(null);
  const userId = user?.userId;

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    getUserHistoryAction(userId)
      .then((items) => {
        if (!cancelled) setHistory({ userId, items });
      })
      .catch(() => {
        if (!cancelled) setHistory({ userId, items: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const items = history && history.userId === userId ? history.items : null;
  const active = user?.access?.active ?? false;

  return (
    <Sheet open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {user ? (
          <>
            <SheetHeader>
              <SheetTitle className="break-all">{user.email}</SheetTitle>
              <SheetDescription>
                Sign-in account and application access are managed separately.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <section aria-labelledby="detail-identity">
                <h3 id="detail-identity" className="text-sm font-semibold">
                  Identity
                </h3>
                <dl className="divide-y">
                  <Row label="Auth account">Exists</Row>
                  <Row label="Account ID">
                    <span className="font-mono text-xs">{user.userId}</span>
                  </Row>
                  <Row label="Sign-in">
                    <Badge variant="outline">{authStatus(user)}</Badge>
                  </Row>
                  <Row label="Created">{formatWhen(user.createdAt)}</Row>
                  <Row label="Last sign-in">
                    {formatWhen(user.lastSignInAt)}
                  </Row>
                </dl>
              </section>
              <Separator />
              <section aria-labelledby="detail-access">
                <h3 id="detail-access" className="text-sm font-semibold">
                  Application access
                </h3>
                <dl className="divide-y">
                  <Row label="Role">
                    {roleLabel(active ? user.access?.level : null)}
                  </Row>
                  <Row label="Committee">{scopeLabel(user)}</Row>
                  <Row label="Admin access">{active ? "Yes" : "No"}</Row>
                  <Row label="Status">
                    <Badge variant={active ? "secondary" : "outline"}>
                      {accessStatus(user)}
                    </Badge>
                  </Row>
                </dl>
              </section>
              {canAdminister ? (
                <>
                  <Separator />
                  <section
                    aria-labelledby="detail-actions"
                    className="flex flex-col gap-2"
                  >
                    <h3 id="detail-actions" className="text-sm font-semibold">
                      Actions
                    </h3>
                    {!active ? (
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => onAction("assign", user)}
                      >
                        <ShieldPlus data-icon="inline-start" />
                        Assign role
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => onAction("revoke", user)}
                      >
                        <UserMinus data-icon="inline-start" />
                        Revoke access
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="justify-start"
                      onClick={() => onAction("reset", user)}
                    >
                      <Mail data-icon="inline-start" />
                      Send password-reset email
                    </Button>
                    {!user.emailConfirmed || user.invited ? (
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => onAction("resend", user)}
                      >
                        <Mail data-icon="inline-start" />
                        Resend invitation
                      </Button>
                    ) : null}
                    {!isSelf ? (
                      <Button
                        variant="outline"
                        className="justify-start"
                        onClick={() => onAction("password", user)}
                      >
                        <KeyRound data-icon="inline-start" />
                        Set temporary password
                      </Button>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Passwords are write-only. Nobody, including the Technical
                      Team, can read an existing password.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Offboarding revokes application access and retains the
                      Auth identity and history. Auth deletion requires a
                      separate reference review.
                    </p>
                  </section>
                </>
              ) : null}
              <Separator />
              <section aria-labelledby="detail-history">
                <h3 id="detail-history" className="text-sm font-semibold">
                  History
                </h3>
                {history?.userId === userId && history?.failed ? (
                  <p
                    role="alert"
                    className="mt-2 text-sm text-muted-foreground"
                  >
                    History could not be loaded. Close and reopen these details
                    to retry.
                  </p>
                ) : items === null ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ) : items.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No recorded changes.
                  </p>
                ) : (
                  <ol className="mt-2 flex flex-col gap-3">
                    {items.map((item) => (
                      <li key={item.id} className="text-sm">
                        <p className="font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatWhen(item.when)} · by {item.actor}
                          {item.detail ? ` · ${item.detail}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
