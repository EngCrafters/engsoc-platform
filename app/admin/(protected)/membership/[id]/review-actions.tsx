"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  CircleSlash,
  MailPlus,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import {
  activateMembershipAction,
  reviewMembershipAction,
  type MembershipActionState,
} from "../actions";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { membershipMessage } from "@/lib/membership/labels";
import type {
  ApplicationStatus,
  ApprovalPolicy,
  ReviewerKind,
} from "@/lib/membership/types";

type Props = {
  applicationId: string;
  revision: number;
  status: ApplicationStatus;
  activated: boolean;
  reviewer: ReviewerKind;
  policy: ApprovalPolicy | null;
  verifiedByMe: boolean;
  ownApplication: boolean;
};

const FORM_ID = "membership-review-form";

const SUCCESS_TEXT: Record<string, string> = {
  verify: "Application verified",
  approve: "Application approved",
  reject: "Application rejected",
};

function Decision({
  decision,
  icon: Icon,
  label,
  title,
  description,
  disabled,
  hint,
  destructive = false,
  primary = false,
  children,
}: {
  decision: "verify" | "approve" | "reject";
  icon: LucideIcon;
  label: string;
  title: string;
  description: string;
  disabled?: boolean;
  hint?: string;
  destructive?: boolean;
  primary?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            disabled={disabled}
            variant={
              primary ? "default" : destructive ? "destructive" : "outline"
            }
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
            {label}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {children}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              form={FORM_ID}
              name="decision"
              value={decision}
              variant={destructive ? "destructive" : "default"}
            >
              {label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {hint ? (
        <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The reviewer's actions. Buttons only describe what the database will allow;
 * the routine decides, so a stale page or a forged request gets a clear error.
 */
export function ReviewActions(props: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    MembershipActionState,
    FormData
  >(reviewMembershipAction, null);
  const [activation, activate, activating] = useActionState<
    MembershipActionState,
    FormData
  >(activateMembershipAction, null);
  const [note, setNote] = useState("");
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.code === "SUCCESS") {
      toast.success(SUCCESS_TEXT[state.decision ?? "verify"], {
        id: `membership-${props.applicationId}`,
      });
      if (
        state.decision === "approve" &&
        state.activation &&
        state.activation !== "SUCCESS"
      )
        feedback.current?.focus();
      router.refresh();
    } else if (state?.code) feedback.current?.focus();
  }, [router, state, props.applicationId]);

  useEffect(() => {
    if (activation?.code === "SUCCESS") {
      toast.success("Membership activated", {
        id: `membership-activate-${props.applicationId}`,
      });
      router.refresh();
    } else if (activation?.code) feedback.current?.focus();
  }, [router, activation, props.applicationId]);

  const open = props.status === "pending_review" || props.status === "verified";
  const policyHint =
    props.policy === null
      ? "Final approval is disabled until the owner's approval policy is recorded."
      : undefined;
  const approveBlock =
    policyHint ??
    (props.policy === "two_step" && props.status !== "verified"
      ? "Verify the application first; final approval follows from a different Senior Management reviewer."
      : props.policy === "two_step" && props.reviewer !== "senior"
        ? "Under the two-step policy, Senior Management gives final approval."
        : props.policy === "two_step" && props.verifiedByMe
          ? "You verified this application; a different Senior Management reviewer must approve it."
          : undefined);

  const error =
    state?.code && state.code !== "SUCCESS"
      ? state.code
      : activation?.code && activation.code !== "SUCCESS"
        ? activation.code
        : null;
  const activationProblem =
    state?.code === "SUCCESS" &&
    state.activation &&
    state.activation !== "SUCCESS"
      ? state.activation
      : null;

  if (props.ownApplication) {
    return (
      <Alert>
        <AlertTitle>This is your own application</AlertTitle>
        <AlertDescription>
          Another reviewer must review it. Its ID card is not available to you.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {open ? (
        <form
          id={FORM_ID}
          action={action}
          className="flex flex-wrap gap-4"
          aria-busy={pending}
        >
          <input
            type="hidden"
            name="applicationId"
            value={props.applicationId}
          />
          <input type="hidden" name="revision" value={props.revision} />
          <input type="hidden" name="note" value={note} />
          {props.status === "pending_review" ? (
            <Decision
              decision="verify"
              icon={ScanSearch}
              label="Mark as verified"
              title="Mark this application as verified?"
              description="Confirm the name, student ID and photo on the SQU ID card match the application. Verification alone grants nothing."
              disabled={pending}
            />
          ) : null}
          <Decision
            decision="approve"
            icon={BadgeCheck}
            label="Approve and invite"
            title="Approve this membership?"
            description="The ID card is deleted and the applicant receives an email invitation to set their password. Membership grants no administrative access."
            disabled={pending || Boolean(approveBlock)}
            hint={approveBlock}
            primary
          >
            <NoteField
              note={note}
              setNote={setNote}
              label="Internal note (optional)"
            />
          </Decision>
          <Decision
            decision="reject"
            icon={CircleSlash}
            label="Reject"
            title="Reject this application?"
            description="The ID card is deleted. The applicant sees that the application was not approved and may apply again. The note stays internal."
            disabled={pending}
            destructive
          >
            <NoteField
              note={note}
              setNote={setNote}
              label="Internal reason (optional, never shown to the applicant)"
            />
          </Decision>
        </form>
      ) : null}

      {props.status === "approved" && !props.activated ? (
        <form
          action={activate}
          className="flex flex-col items-start gap-1.5"
          aria-busy={activating}
        >
          <input
            type="hidden"
            name="applicationId"
            value={props.applicationId}
          />
          <Button type="submit" disabled={activating}>
            <MailPlus aria-hidden="true" data-icon="inline-start" />
            Send invitation and activate
          </Button>
          <p className="text-xs text-muted-foreground">
            Approved, but the member account is not active yet. This sends the
            standard invitation email (or links the existing account) and
            creates the member record.
          </p>
        </form>
      ) : null}

      {error || activationProblem ? (
        <div ref={feedback} tabIndex={-1} className="outline-none">
          <Alert variant="destructive">
            <AlertTitle>
              {activationProblem
                ? "Approved, but not activated yet"
                : "That didn't go through"}
            </AlertTitle>
            <AlertDescription>
              {membershipMessage(activationProblem ?? error ?? undefined)}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
    </div>
  );
}

function NoteField({
  note,
  setNote,
  label,
}: {
  note: string;
  setNote: (value: string) => void;
  label: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="membership-note">{label}</Label>
      <Textarea
        id="membership-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        rows={3}
      />
      <p className="text-xs text-muted-foreground">
        {500 - note.length} characters left
      </p>
    </div>
  );
}
