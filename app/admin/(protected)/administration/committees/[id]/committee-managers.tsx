"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { AccessLevel } from "@/lib/auth/manager";
import { formatDay } from "@/lib/administration/labels";
import {
  AccessDialog,
  type AccessSelection,
} from "../../../access/access-dialog";
import {
  changeAccessAction,
  type AccessActionState,
} from "../../../access/actions";
import {
  SuspensionDialog,
  type SuspensionTarget,
} from "../../../access/suspension-dialog";
import type { Committee, UserRecord } from "../../../access/user-types";

export type ManagerRow = {
  userId: string;
  email: string;
  active: boolean;
  grantedAt: string;
  revokedAt: string | null;
  revocationKind: "revoked" | "suspended" | null;
};

/**
 * Who leads this committee: active managers first, then suspended and former ones. Assign,
 * replace (leadership transfer), suspend, reactivate and revoke all go through the access
 * routines, so the same rules and audit apply as on the accounts page.
 */
export function CommitteeManagers({
  committee,
  archived,
  managers,
  users,
  committees,
  actorLevel,
  currentUserId,
}: {
  committee: Committee;
  archived: boolean;
  managers: ManagerRow[];
  users: UserRecord[];
  committees: Committee[];
  actorLevel: AccessLevel;
  currentUserId: string;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [access, setAccess] = useState<AccessSelection | null>(null);
  const [suspension, setSuspension] = useState<SuspensionTarget | null>(null);
  const closeAccess = useCallback(() => setAccess(null), []);
  const closeSuspension = useCallback(() => setSuspension(null), []);
  const byId = useMemo(
    () => new Map(users.map((user) => [user.userId, user])),
    [users]
  );
  const active = managers.filter((manager) => manager.active);
  const former = managers.filter((manager) => !manager.active);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {active.length === 0
            ? "No active manager. Board Administration and the Technical Team can still run this committee."
            : `${active.length} active manager${active.length === 1 ? "" : "s"}.`}
        </p>
        <Button
          size="sm"
          onClick={() => setAssignOpen(true)}
          disabled={archived}
        >
          <UserPlus data-icon="inline-start" aria-hidden="true" /> Assign
          manager
        </Button>
      </div>
      {managers.length === 0 ? null : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {[...active, ...former].map((manager) => {
            const user = byId.get(manager.userId);
            const self = manager.userId === currentUserId;
            const suspended = manager.revocationKind === "suspended";
            return (
              <li
                key={manager.userId}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {manager.email}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {manager.active
                      ? `Manager since ${formatDay(manager.grantedAt)}`
                      : `${suspended ? "Suspended" : "Former manager"} · ${formatDay(manager.revokedAt)}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Badge variant={manager.active ? "secondary" : "outline"}>
                    {manager.active
                      ? "Active"
                      : suspended
                        ? "Suspended"
                        : "Revoked"}
                  </Badge>
                  {self || !user || (!manager.active && !suspended) ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${manager.email}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-52">
                        {manager.active ? (
                          <>
                            <DropdownMenuItem
                              onSelect={() =>
                                setAccess({
                                  operation: "replace",
                                  user,
                                  level: "COMMITTEE_MANAGER",
                                })
                              }
                            >
                              Transfer leadership
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                setSuspension({
                                  userId: manager.userId,
                                  email: manager.email,
                                  suspend: true,
                                  role: "Committee Manager",
                                })
                              }
                            >
                              Suspend access
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setAccess({
                                  operation: "revoke",
                                  user,
                                  level: "COMMITTEE_MANAGER",
                                })
                              }
                            >
                              Revoke manager access
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem
                            disabled={archived}
                            onSelect={() =>
                              setSuspension({
                                userId: manager.userId,
                                email: manager.email,
                                suspend: false,
                                role: "Committee Manager",
                              })
                            }
                          >
                            Reactivate access
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <AssignManagerDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        committee={committee}
        candidates={users.filter(
          (user) => !user.access?.active && user.userId !== currentUserId
        )}
      />
      <AccessDialog
        selection={access}
        committees={committees}
        users={users}
        actorLevel={actorLevel}
        onClose={closeAccess}
      />
      <SuspensionDialog target={suspension} onClose={closeSuspension} />
    </div>
  );
}

const initial: AccessActionState = { success: false, message: "" };

/** Pick an account without active access and make it this committee's manager. */
function AssignManagerDialog({
  open,
  onOpenChange,
  committee,
  candidates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  committee: Committee;
  candidates: UserRecord[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <AssignForm
          committee={committee}
          candidates={candidates}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function AssignForm({
  committee,
  candidates,
  onClose,
}: {
  committee: Committee;
  candidates: UserRecord[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<UserRecord | null>(null);
  const [state, action, pending] = useActionState(
    async (previous: AccessActionState, form: FormData) => {
      const result = await changeAccessAction(previous, form);
      if (result.success) {
        toast.success(result.message);
        onClose();
        router.refresh();
      }
      return result;
    },
    initial
  );
  const matches = candidates
    .filter((user) =>
      user.email.toLowerCase().includes(query.trim().toLowerCase())
    )
    .slice(0, 8);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Assign a manager</DialogTitle>
        <DialogDescription>
          {committee.name}. A manager has exactly one committee. To bring in
          someone new, invite them from Accounts &amp; access first.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="grid gap-4">
        <input type="hidden" name="operation" value="grant" />
        <input type="hidden" name="level" value="COMMITTEE_MANAGER" />
        <input type="hidden" name="committeeId" value={committee.id} />
        <input type="hidden" name="userId" value={chosen?.userId ?? ""} />
        <div className="grid gap-1.5">
          <Label htmlFor="assign-search">Account</Label>
          <Input
            id="assign-search"
            placeholder="Search by email"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setChosen(null);
            }}
            autoComplete="off"
          />
          <ul
            role="listbox"
            aria-label="Matching accounts"
            className="flex max-h-56 flex-col overflow-y-auto rounded-lg border"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No eligible account matches.
              </li>
            ) : (
              matches.map((user) => (
                <li
                  key={user.userId}
                  role="option"
                  aria-selected={chosen?.userId === user.userId}
                >
                  <button
                    type="button"
                    onClick={() => setChosen(user)}
                    className="w-full truncate px-3 py-2 text-left text-sm hover:bg-muted aria-pressed:bg-muted aria-pressed:font-medium"
                    aria-pressed={chosen?.userId === user.userId}
                  >
                    {user.email}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="assign-note">Note (optional)</Label>
          <Input
            id="assign-note"
            name="note"
            maxLength={200}
            placeholder="Reason for this change"
          />
        </div>
        {state.message && !state.success ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!chosen || pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {chosen ? `Assign ${chosen.email}` : "Choose an account"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
