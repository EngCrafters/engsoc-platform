"use client";

import { useActionState, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccessRow } from "@/lib/access/server";
import { changeAccessAction, type AccessActionState } from "./actions";

type Choice = { id: string; name: string };
type Selection = {
  operation: "grant" | "reassign" | "revoke";
  userId: string;
  level: "COMMITTEE_MANAGER" | "BOARD_ADMIN" | "TECHNICAL";
  committeeId: string;
  previousCommitteeName?: string;
};
const initial: AccessActionState = { success: false, message: "" };

function roleLabel(level: AccessRow["access_level"]) {
  return level === "TECHNICAL"
    ? "Technical Team"
    : level === "BOARD_ADMIN"
      ? "Board Administration"
      : "Committee Manager";
}

export function AccessManagement({
  rows,
  users,
  committees,
}: {
  rows: AccessRow[];
  users: { user_id: string; email: string }[];
  committees: Choice[];
}) {
  const [selection, setSelection] = useState<Selection>({
    operation: "grant",
    userId: "",
    level: "COMMITTEE_MANAGER",
    committeeId: "",
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [state, action, pending] = useActionState(
    async (previous: AccessActionState, form: FormData) => {
      const result = await changeAccessAction(previous, form);
      if (result.success) setOpen(false);
      return result;
    },
    initial
  );

  function begin(next: Selection) {
    setSelection(next);
    setUserQuery("");
    setOpen(true);
  }
  const chosen = users.find((user) => user.user_id === selection.userId);
  const chosenAssignment = rows.find(
    (row) => row.user_id === selection.userId && row.active
  );
  const committee = committees.find(
    (item) => item.id === selection.committeeId
  );
  const valid =
    !!selection.userId &&
    (selection.operation === "revoke" ||
      selection.level !== "COMMITTEE_MANAGER" ||
      !!selection.committeeId);
  const visibleRows = rows.filter((row) =>
    `${row.email ?? row.user_id} ${roleLabel(row.access_level)} ${row.committee_name ?? "All Committees"}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          aria-label="Search access assignments"
          placeholder="Search users, roles, or committees"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <Button
          onClick={() =>
            begin({
              operation: "grant",
              userId: "",
              level: "COMMITTEE_MANAGER",
              committeeId: "",
            })
          }
        >
          Add access
        </Button>
      </div>
      {state.message ? (
        <p
          role="status"
          className={
            state.success
              ? "text-sm text-foreground"
              : "text-sm text-destructive"
          }
        >
          {state.message}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-180">
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Committee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.user_id}>
                <TableCell className="font-medium">
                  {row.email ?? row.user_id}
                </TableCell>
                <TableCell>{roleLabel(row.access_level)}</TableCell>
                <TableCell>{row.committee_name ?? "All Committees"}</TableCell>
                <TableCell>
                  <Badge variant={row.active ? "secondary" : "outline"}>
                    {row.active ? "Active" : "Revoked"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {row.active ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${row.email ?? row.user_id}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {row.access_level === "COMMITTEE_MANAGER" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              begin({
                                operation: "reassign",
                                userId: row.user_id,
                                level: "COMMITTEE_MANAGER",
                                committeeId: "",
                                previousCommitteeName:
                                  row.committee_name ?? undefined,
                              })
                            }
                          >
                            Reassign committee
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            begin({
                              operation: "revoke",
                              userId: row.user_id,
                              level: row.access_level,
                              committeeId: row.committee_id ?? "",
                            })
                          }
                        >
                          {row.access_level === "TECHNICAL"
                            ? "Revoke Technical access"
                            : row.access_level === "BOARD_ADMIN"
                              ? "Revoke Board Administration"
                              : "Revoke manager access"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  {rows.length === 0
                    ? "No access assignments yet."
                    : "No assignments match your search."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selection.operation === "grant"
                ? selection.level === "TECHNICAL"
                  ? "Grant Technical Team access"
                  : selection.level === "BOARD_ADMIN"
                    ? "Grant Board Administration"
                    : "Assign Committee Manager"
                : selection.operation === "reassign"
                  ? "Reassign committee"
                  : selection.level === "TECHNICAL"
                    ? "Remove Technical Team access"
                    : "Revoke access"}
            </DialogTitle>
            <DialogDescription>
              Changes take effect immediately and are recorded in the access
              audit.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="operation" value={selection.operation} />
            <input type="hidden" name="userId" value={selection.userId} />
            <input type="hidden" name="level" value={selection.level} />
            <input
              type="hidden"
              name="committeeId"
              value={
                selection.level === "COMMITTEE_MANAGER"
                  ? selection.committeeId
                  : ""
              }
            />
            <div className="space-y-2">
              <Label htmlFor="access-user">User</Label>
              {selection.operation === "grant" ? (
                <div className="space-y-2">
                  <Input
                    aria-label="Search authenticated users"
                    placeholder="Search by email"
                    value={userQuery}
                    onChange={(event) => setUserQuery(event.target.value)}
                  />
                  <Select
                    value={selection.userId}
                    onValueChange={(userId) =>
                      setSelection((value) => ({ ...value, userId }))
                    }
                  >
                    <SelectTrigger id="access-user" className="w-full">
                      <SelectValue placeholder="Select an authenticated user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users
                        .filter((user) =>
                          user.email
                            .toLowerCase()
                            .includes(userQuery.trim().toLowerCase())
                        )
                        .map((user) => (
                          <SelectItem key={user.user_id} value={user.user_id}>
                            {user.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm">{chosen?.email ?? selection.userId}</p>
              )}
            </div>
            {selection.operation === "grant" ? (
              <div className="space-y-2">
                <Label htmlFor="access-role">Role</Label>
                <Select
                  value={selection.level}
                  onValueChange={(level) =>
                    setSelection((value) => ({
                      ...value,
                      level: level as Selection["level"],
                      committeeId: "",
                    }))
                  }
                >
                  <SelectTrigger id="access-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COMMITTEE_MANAGER">
                      Committee Manager
                    </SelectItem>
                    <SelectItem value="BOARD_ADMIN">
                      Board Administration
                    </SelectItem>
                    <SelectItem value="TECHNICAL">Technical Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {selection.level === "COMMITTEE_MANAGER" &&
            selection.operation !== "revoke" ? (
              <div className="space-y-2">
                <Label htmlFor="access-committee">Committee</Label>
                <Select
                  value={selection.committeeId}
                  onValueChange={(committeeId) =>
                    setSelection((value) => ({ ...value, committeeId }))
                  }
                >
                  <SelectTrigger id="access-committee" className="w-full">
                    <SelectValue placeholder="Select one committee" />
                  </SelectTrigger>
                  <SelectContent>
                    {committees
                      .filter(
                        (item) => item.name !== selection.previousCommitteeName
                      )
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {selection.operation === "grant" &&
            selection.level === "COMMITTEE_MANAGER" &&
            chosenAssignment?.access_level === "COMMITTEE_MANAGER" &&
            chosenAssignment.committee_id !== selection.committeeId ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <p>
                  This user already manages another committee. Reassign their
                  committee instead.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelection((value) => ({
                      ...value,
                      operation: "reassign",
                      previousCommitteeName:
                        chosenAssignment.committee_name ?? undefined,
                    }))
                  }
                >
                  Reassign manager
                </Button>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="access-note">Note (optional)</Label>
              <Input
                id="access-note"
                name="note"
                maxLength={200}
                placeholder="Reason for this change"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {selection.operation === "reassign"
                ? `Reassign this manager from ${selection.previousCommitteeName ?? "their current committee"} to ${committee?.name ?? "the selected committee"}? Old access ends, new access starts, event ownership stays the same, and the change is audited.`
                : selection.operation === "revoke"
                  ? selection.level === "TECHNICAL"
                    ? "This removes full application control. At least one other active Technical Team administrator must remain."
                    : "This user will lose administrative access."
                  : selection.level === "TECHNICAL"
                    ? "This grants full application-level administrative authority, including the ability to manage Technical Team access."
                    : selection.level === "BOARD_ADMIN"
                      ? "Grant society-wide operational access."
                      : `Grant access to ${committee?.name ?? "one committee"}.`}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || pending}>
                {pending
                  ? "Saving…"
                  : selection.operation === "reassign"
                    ? "Reassign manager"
                    : selection.operation === "revoke"
                      ? "Confirm revocation"
                      : selection.level === "TECHNICAL"
                        ? "Grant Technical access"
                        : "Confirm assignment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
