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
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/callback";
import type { AccessLevel } from "@/lib/auth/manager";
import { createUserAction } from "./user-actions";
import { initialUserActionState } from "./user-state";
import { roleLabel, type Committee } from "./user-types";

type Method = "invite" | "no_email" | "password";

const METHOD_HELP: Record<Method, string> = {
  invite:
    "Sends an invitation email. The person sets their own password. Preferred whenever email delivery works.",
  no_email:
    "Creates the sign-in account without sending anything. The person sets a password later with 'Forgot your password?'.",
  password:
    "Pilot fallback when email cannot be relied on. You choose a temporary password and share it privately; it is never shown again or stored in the audit.",
};

export function AddUserDialog({
  open,
  onOpenChange,
  committees,
  actorLevel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  committees: Committee[];
  /** Board Administration invites Committee Managers by email only (ADR 0024). */
  actorLevel: AccessLevel;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <AddUserForm
          committees={committees}
          technical={actorLevel === "TECHNICAL"}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function AddUserForm({
  committees,
  technical,
  onClose,
}: {
  committees: Committee[];
  technical: boolean;
  onClose: () => void;
}) {
  const [level, setLevel] = useState<AccessLevel | "NONE">("COMMITTEE_MANAGER");
  const [committeeId, setCommitteeId] = useState("");
  const [method, setMethod] = useState<Method>("invite");
  const [state, action, pending] = useActionState(
    createUserAction,
    initialUserActionState
  );

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const needsCommittee = level === "COMMITTEE_MANAGER";
  const canSubmit = !needsCommittee || committeeId !== "";

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add user</DialogTitle>
        <DialogDescription>
          Create a sign-in account, then choose its application access. Choose
          None to prepare an identity for manager replacement without granting
          access.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="grid gap-4" autoComplete="off">
        <input type="hidden" name="level" value={level} />
        <input
          type="hidden"
          name="committeeId"
          value={needsCommittee ? committeeId : ""}
        />
        <input type="hidden" name="method" value={method} />
        <div className="grid gap-1.5">
          <Label htmlFor="add-email">Email address</Label>
          <Input
            id="add-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            maxLength={320}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="add-role">Role</Label>
          <Select
            value={level}
            onValueChange={(value) => {
              setLevel(value as AccessLevel | "NONE");
              setCommitteeId("");
            }}
          >
            <SelectTrigger id="add-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="NONE">
                  None — sign-in account only
                </SelectItem>
                {(technical
                  ? (["COMMITTEE_MANAGER", "BOARD_ADMIN", "TECHNICAL"] as const)
                  : (["COMMITTEE_MANAGER"] as const)
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {roleLabel(value)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {needsCommittee ? (
          <div className="grid gap-1.5">
            <Label htmlFor="add-committee">Committee</Label>
            <Select value={committeeId} onValueChange={setCommitteeId}>
              <SelectTrigger id="add-committee" className="w-full">
                <SelectValue placeholder="Select one committee" />
              </SelectTrigger>
              <SelectContent>
                {committees.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="add-method">How should they get in?</Label>
          <Select
            value={method}
            onValueChange={(value) => setMethod(value as Method)}
          >
            <SelectTrigger id="add-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="invite">Send invitation email</SelectItem>
              {technical ? (
                <>
                  <SelectItem value="no_email">Create without email</SelectItem>
                  <SelectItem value="password">
                    Set temporary password
                  </SelectItem>
                </>
              ) : null}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{METHOD_HELP[method]}</p>
        </div>
        {method === "password" ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="add-password">Temporary password</Label>
              <Input
                id="add-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <p className="text-xs text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-confirm">Confirm password</Label>
              <Input
                id="add-confirm"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
          </div>
        ) : null}
        {state.status === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Creating…" : "Add user"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
