"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AccessLevel } from "@/lib/auth/manager";
import {
  changeAccessAction,
  replaceManagerAction,
  type AccessActionState,
} from "./actions";
import { roleLabel, type Committee, type UserRecord } from "./user-types";

export type AccessSelection = {
  operation: "grant" | "reassign" | "revoke" | "replace";
  user: UserRecord;
  level: AccessLevel;
};

const initial: AccessActionState = { success: false, message: "" };

function title(selection: AccessSelection) {
  const { operation, level } = selection;
  if (operation === "replace") return "Replace manager";
  if (operation === "reassign") return "Reassign committee";
  if (operation === "revoke") {
    return level === "TECHNICAL"
      ? "Remove Technical Team access"
      : "Revoke access";
  }
  return level === "TECHNICAL"
    ? "Grant Technical Team access"
    : level === "BOARD_ADMIN"
      ? "Grant Board Administration"
      : "Assign Committee Manager";
}

function consequence(
  selection: AccessSelection,
  committee: Committee | undefined
) {
  const { operation, level, user } = selection;
  if (operation === "replace") {
    return `Revoke ${user.email}'s access and assign the replacement to ${user.access?.committeeName}. Both changes happen together. Sign-in accounts and historical activity are retained.`;
  }
  if (operation === "reassign") {
    return `Old access ends and new access starts together. Event ownership stays with each event's committee. ${
      user.access?.committeeName
        ? `Current committee: ${user.access.committeeName}.`
        : ""
    }`;
  }
  if (operation === "revoke") {
    return level === "TECHNICAL"
      ? "This removes full application control. At least one other active Technical Team administrator must remain. The sign-in account is kept."
      : "This account loses dashboard access immediately. The sign-in account is kept.";
  }
  return level === "TECHNICAL"
    ? "Grants full application authority, including managing Technical Team access."
    : level === "BOARD_ADMIN"
      ? "Grants society-wide operational access to every committee. It cannot manage users."
      : `A manager has exactly one committee. Grants access to ${committee?.name ?? "the selected committee"} only.`;
}

/** Grant, reassign or revoke application access for one account. */
export function AccessDialog({
  selection,
  committees,
  users,
  onClose,
}: {
  selection: AccessSelection | null;
  committees: Committee[];
  users: UserRecord[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open={selection !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      {selection ? (
        <AccessForm
          key={`${selection.user.userId}-${selection.operation}-${selection.level}`}
          selection={selection}
          committees={committees}
          users={users}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function AccessForm({
  selection,
  committees,
  users,
  onClose,
}: {
  selection: AccessSelection;
  committees: Committee[];
  users: UserRecord[];
  onClose: () => void;
}) {
  const { operation, user } = selection;
  const [level, setLevel] = useState<AccessLevel>(selection.level);
  const [committeeId, setCommitteeId] = useState("");
  const [newUserId, setNewUserId] = useState("");
  const [state, action, pending] = useActionState(
    operation === "replace" ? replaceManagerAction : changeAccessAction,
    initial
  );

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const needsCommittee =
    level === "COMMITTEE_MANAGER" &&
    operation !== "revoke" &&
    operation !== "replace";
  const valid =
    operation === "replace"
      ? newUserId !== ""
      : operation === "revoke" || !needsCommittee || committeeId !== "";
  const replacements = users.filter(
    (candidate) => candidate.userId !== user.userId && !candidate.access?.active
  );
  const committee = committees.find((item) => item.id === committeeId);
  const choices =
    operation === "reassign"
      ? committees.filter((item) => item.id !== user.access?.committeeId)
      : committees;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title({ ...selection, level })}</DialogTitle>
        <DialogDescription>
          {user.email}. Changes take effect immediately and are recorded in the
          access audit.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="grid gap-4">
        <input type="hidden" name="operation" value={operation} />
        <input
          type="hidden"
          name={operation === "replace" ? "oldUserId" : "userId"}
          value={user.userId}
        />
        <input type="hidden" name="level" value={level} />
        <input
          type="hidden"
          name="committeeId"
          value={
            level === "COMMITTEE_MANAGER"
              ? operation === "revoke" || operation === "replace"
                ? (user.access?.committeeId ?? "")
                : committeeId
              : ""
          }
        />
        {operation === "replace" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="replacement-user">Replacement account</Label>
            <input type="hidden" name="newUserId" value={newUserId} />
            <Select value={newUserId} onValueChange={setNewUserId}>
              <SelectTrigger id="replacement-user" className="w-full">
                <SelectValue placeholder="Select an account without active access" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {replacements.map((candidate) => (
                    <SelectItem key={candidate.userId} value={candidate.userId}>
                      {candidate.email}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {replacements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No eligible account. Add the real user&apos;s identity before
                replacing this manager.
              </p>
            ) : null}
          </div>
        ) : null}
        {operation === "grant" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="access-role">Role</Label>
            <Select
              value={level}
              onValueChange={(value) => {
                setLevel(value as AccessLevel);
                setCommitteeId("");
              }}
            >
              <SelectTrigger id="access-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["COMMITTEE_MANAGER", "BOARD_ADMIN", "TECHNICAL"] as const
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {roleLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {needsCommittee ? (
          <div className="grid gap-1.5">
            <Label htmlFor="access-committee">Committee</Label>
            <Select value={committeeId} onValueChange={setCommitteeId}>
              <SelectTrigger id="access-committee" className="w-full">
                <SelectValue placeholder="Select one committee" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="access-note">Note (optional)</Label>
          <Input
            id="access-note"
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
        <p className="text-sm text-muted-foreground">
          {consequence({ ...selection, level }, committee)}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={operation === "revoke" ? "destructive" : "default"}
            disabled={!valid || pending}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending
              ? "Saving…"
              : operation === "revoke"
                ? "Confirm revocation"
                : operation === "reassign"
                  ? "Reassign manager"
                  : operation === "replace"
                    ? "Confirm replacement"
                    : "Confirm assignment"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
