"use client";

import { useActionState, useState } from "react";
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
  level: "COMMITTEE_MANAGER" | "BOARD_ADMIN";
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
    setOpen(true);
  }
  const chosen = users.find((user) => user.user_id === selection.userId);
  const committee = committees.find(
    (item) => item.id === selection.committeeId
  );
  const valid =
    !!selection.userId &&
    (selection.level === "BOARD_ADMIN" || !!selection.committeeId);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
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
          Assign access
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
      <div className="rounded-lg border">
        <Table>
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
            {rows.map((row) => (
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
                <TableCell className="space-x-2 text-right">
                  {row.active && row.access_level === "COMMITTEE_MANAGER" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
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
                      Reassign
                    </Button>
                  ) : null}
                  {row.active && row.access_level !== "TECHNICAL" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        begin({
                          operation: "revoke",
                          userId: row.user_id,
                          level: row.access_level as Selection["level"],
                          committeeId: row.committee_id ?? "",
                        })
                      }
                    >
                      Revoke
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No access assignments yet.
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
                ? "Assign access"
                : selection.operation === "reassign"
                  ? "Reassign committee"
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
                selection.level === "BOARD_ADMIN" ? "" : selection.committeeId
              }
            />
            <div className="space-y-2">
              <Label htmlFor="access-user">User</Label>
              {selection.operation === "grant" ? (
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
                    {users.map((user) => (
                      <SelectItem key={user.user_id} value={user.user_id}>
                        {user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                ? `${selection.previousCommitteeName ?? "Current committee"} → ${committee?.name ?? "select a new committee"}. Their previous committee access will end.`
                : selection.operation === "revoke"
                  ? "This user will lose administrative access."
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
                {pending ? "Saving…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
