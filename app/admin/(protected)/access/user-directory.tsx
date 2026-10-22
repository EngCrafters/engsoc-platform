"use client";

import { useCallback, useState, useTransition } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PermanentDeletionDialog } from "@/components/admin/permanent-deletion-dialog";
import type { AccessLevel } from "@/lib/auth/manager";
import { AccessDialog, type AccessSelection } from "./access-dialog";
import { SuspensionDialog, type SuspensionTarget } from "./suspension-dialog";
import { AddUserDialog } from "./add-user-dialog";
import { PasswordDialog } from "./password-dialog";
import { UserDetailsSheet, type DetailAction } from "./user-details-sheet";
import { resendInvitationAction, sendResetEmailAction } from "./user-actions";
import {
  accessStatus,
  authStatus,
  formatWhen,
  roleLabel,
  scopeLabel,
  type Committee,
  type UserRecord,
} from "./user-types";

type Confirm = { kind: "reset" | "resend"; user: UserRecord };

/**
 * The account directory. Rows are Auth identities; the Role, Committee and Access columns come
 * from the separate application-access grant. Board Administration manages Committee Managers;
 * the Technical Team every role, credentials and account deletion (ADR 0024). The menu mirrors
 * those rules; the database enforces them.
 */
export function UserDirectory({
  users,
  committees,
  currentUserId,
  actorLevel,
  adminConfigured,
}: {
  users: UserRecord[];
  committees: Committee[];
  currentUserId: string;
  actorLevel: AccessLevel;
  /** False when the server has no Auth Admin key, so account creation is off. */
  adminConfigured: boolean;
}) {
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<UserRecord | null>(null);
  const [access, setAccess] = useState<AccessSelection | null>(null);
  const [passwordFor, setPasswordFor] = useState<UserRecord | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [suspension, setSuspension] = useState<SuspensionTarget | null>(null);
  const [erase, setErase] = useState<UserRecord | null>(null);
  const technical = actorLevel === "TECHNICAL";
  /** Board Administration acts only on accounts without senior access. */
  const manageable = (user: UserRecord) =>
    technical ||
    !user.access ||
    user.access.level === "COMMITTEE_MANAGER" ||
    (!user.access.active && user.access.revocationKind !== "suspended");
  const [busy, startTransition] = useTransition();

  const closeAccess = useCallback(() => setAccess(null), []);
  const closeSuspension = useCallback(() => setSuspension(null), []);
  const visible = users.filter((user) =>
    `${user.email} ${roleLabel(user.access?.active ? user.access.level : null)} ${scopeLabel(user)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  function run(action: DetailAction, user: UserRecord) {
    if (action === "password") return setPasswordFor(user);
    if (action === "reset" || action === "resend") {
      return setConfirm({ kind: action, user });
    }
    const level = user.access?.level ?? "COMMITTEE_MANAGER";
    setAccess({
      operation: action === "assign" ? "grant" : action,
      user,
      level,
    });
  }

  function submitConfirm() {
    if (!confirm) return;
    const { kind, user } = confirm;
    const form = new FormData();
    form.set("userId", user.userId);
    startTransition(async () => {
      const result =
        kind === "reset"
          ? await sendResetEmailAction({ status: "idle" }, form)
          : await resendInvitationAction({ status: "idle" }, form);
      if (result.status === "success") toast.success(result.message);
      else if (result.status === "error") toast.error(result.message);
      setConfirm(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          aria-label="Search users"
          placeholder="Search by email, role or committee"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <Button onClick={() => setAddOpen(true)} disabled={!adminConfigured}>
          <UserPlus data-icon="inline-start" />
          Add user
        </Button>
      </div>
      {!adminConfigured ? (
        <p role="status" className="text-sm text-muted-foreground">
          Account creation and password tools are off: the server has no Auth
          administration key configured. Role changes still work.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[44rem]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Committee</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="w-px">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((user) => {
              const level = user.access?.level;
              const active = user.access?.active ?? false;
              const isSelf = user.userId === currentUserId;
              return (
                <TableRow key={user.userId}>
                  <TableCell className="max-w-64">
                    <button
                      type="button"
                      onClick={() => setDetail(user)}
                      className="block max-w-full truncate text-left font-medium hover:underline focus-visible:underline"
                    >
                      {user.email}
                    </button>
                    {isSelf ? (
                      <span className="text-xs text-muted-foreground">You</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{roleLabel(active ? level : null)}</TableCell>
                  <TableCell>{scopeLabel(user)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{authStatus(user)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={active ? "secondary" : "outline"}>
                      {accessStatus(user)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${user.email}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-56">
                        <DropdownMenuItem onSelect={() => setDetail(user)}>
                          View details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                          Access
                        </DropdownMenuLabel>
                        {isSelf || !manageable(user) ? (
                          <DropdownMenuItem disabled>
                            {isSelf
                              ? "Your own access"
                              : "Managed by the Technical Team"}
                          </DropdownMenuItem>
                        ) : null}
                        {!isSelf &&
                        manageable(user) &&
                        !active &&
                        user.access?.revocationKind === "suspended" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              setSuspension({
                                userId: user.userId,
                                email: user.email,
                                suspend: false,
                                role: roleLabel(level),
                              })
                            }
                          >
                            Reactivate access
                          </DropdownMenuItem>
                        ) : null}
                        {!isSelf && manageable(user) && !active ? (
                          <DropdownMenuItem
                            onSelect={() => run("assign", user)}
                          >
                            Assign role
                          </DropdownMenuItem>
                        ) : null}
                        {!isSelf && manageable(user) && active ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              setSuspension({
                                userId: user.userId,
                                email: user.email,
                                suspend: true,
                                role: roleLabel(level),
                              })
                            }
                          >
                            Suspend access
                          </DropdownMenuItem>
                        ) : null}
                        {!isSelf && active && level === "COMMITTEE_MANAGER" ? (
                          <DropdownMenuItem
                            onSelect={() => run("replace", user)}
                          >
                            Replace manager
                          </DropdownMenuItem>
                        ) : null}
                        {!isSelf && active && level === "COMMITTEE_MANAGER" ? (
                          <DropdownMenuItem
                            onSelect={() => run("reassign", user)}
                          >
                            Reassign committee
                          </DropdownMenuItem>
                        ) : null}
                        {!isSelf && manageable(user) && active ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => run("revoke", user)}
                          >
                            {level === "TECHNICAL"
                              ? "Revoke Technical access"
                              : level === "BOARD_ADMIN"
                                ? "Revoke Board Administration"
                                : "Revoke manager access"}
                          </DropdownMenuItem>
                        ) : null}
                        {technical && adminConfigured ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                              Password
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onSelect={() => run("reset", user)}
                            >
                              Send reset email
                            </DropdownMenuItem>
                            {!user.emailConfirmed || user.invited ? (
                              <DropdownMenuItem
                                onSelect={() => run("resend", user)}
                              >
                                Resend invitation
                              </DropdownMenuItem>
                            ) : null}
                            {!isSelf ? (
                              <DropdownMenuItem
                                onSelect={() => run("password", user)}
                              >
                                Set temporary password
                              </DropdownMenuItem>
                            ) : null}
                          </>
                        ) : null}
                        {!technical &&
                        adminConfigured &&
                        (!user.emailConfirmed || user.invited) ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => run("resend", user)}
                            >
                              Resend invitation
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        {technical && adminConfigured && !isSelf ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setErase(user)}
                            >
                              Delete account permanently
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  {users.length === 0
                    ? "No accounts yet."
                    : "No users match your search."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        committees={committees}
        actorLevel={actorLevel}
      />
      <AccessDialog
        selection={access}
        committees={committees}
        users={users}
        actorLevel={actorLevel}
        onClose={closeAccess}
      />
      <SuspensionDialog target={suspension} onClose={closeSuspension} />
      {erase ? (
        <PermanentDeletionDialog
          key={erase.userId}
          kind="account"
          id={erase.userId}
          openOnMount
          onClosed={() => setErase(null)}
        />
      ) : null}
      <PasswordDialog user={passwordFor} onClose={() => setPasswordFor(null)} />
      <UserDetailsSheet
        user={detail}
        isSelf={detail?.userId === currentUserId}
        canAdminister={technical && adminConfigured}
        onClose={() => setDetail(null)}
        onAction={(action, user) => {
          setDetail(null);
          run(action, user);
        }}
      />
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "reset"
                ? "Send a password-reset email?"
                : "Send the invitation again?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.user.email} will receive an email with a link to choose
              a new password. Email delivery is limited, so avoid repeated
              requests. Last sign-in:{" "}
              {formatWhen(confirm?.user.lastSignInAt ?? null)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                submitConfirm();
              }}
            >
              {busy ? "Sending…" : "Send email"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
