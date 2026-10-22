"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { setMembershipPolicyAction } from "./actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { POLICY_LABELS, membershipMessage } from "@/lib/membership/labels";
import type { ApprovalPolicy } from "@/lib/membership/types";

type Choice = ApprovalPolicy | "unset";

/**
 * Technical only. Records the owner's decision on final approval (ADR 0017).
 * It is not a preference: until it is recorded, approval and activation are
 * refused by the database.
 */
export function MembershipPolicyForm({
  policy,
}: {
  policy: ApprovalPolicy | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    setMembershipPolicyAction,
    null
  );
  const [choice, setChoice] = useState<Choice>(policy ?? "unset");
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.code === "SUCCESS") {
      toast.success("Approval policy recorded", { id: "membership-policy" });
      router.refresh();
    } else if (state?.code) feedback.current?.focus();
  }, [router, state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Final approval policy</CardTitle>
        <CardDescription>
          Record the owner&apos;s decision. Only the Technical Team can change
          it, and every change is audited.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="membership-policy-form"
          action={action}
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="policy" value={choice} />
          <div className="grid gap-2 sm:w-96">
            <Label htmlFor="membership-policy">Policy</Label>
            <Select
              value={choice}
              onValueChange={(value) => setChoice(value as Choice)}
            >
              <SelectTrigger id="membership-policy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="unset">
                    Not confirmed (approval disabled)
                  </SelectItem>
                  <SelectItem value="two_step">Two steps</SelectItem>
                  <SelectItem value="single_step">One step</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {choice === "unset"
                ? "Applications can be verified or rejected, not approved."
                : POLICY_LABELS[choice]}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                disabled={pending || choice === (policy ?? "unset")}
              >
                <ShieldCheck aria-hidden="true" data-icon="inline-start" />
                Record policy
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Record this approval policy?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {choice === "unset"
                    ? "Final approval and account activation will be disabled again."
                    : `${POLICY_LABELS[choice]} Confirm this is the owner's decision.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction type="submit" form="membership-policy-form">
                  Record policy
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </form>
        {state?.code && state.code !== "SUCCESS" ? (
          <div ref={feedback} tabIndex={-1} className="mt-4 outline-none">
            <Alert variant="destructive">
              <AlertTitle>The policy was not changed</AlertTitle>
              <AlertDescription>
                {membershipMessage(state.code)}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
