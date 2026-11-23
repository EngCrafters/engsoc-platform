"use client";

import {
  useActionState,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { verificationMessage } from "@/lib/verification/labels";

export type ReviewDialogState = { code: string; field?: string } | null;

const FIELD_MESSAGES: Record<string, string> = {
  reason: "Write the reason the member will see (up to 500 characters).",
  rejectionReason:
    "Write the reason the member will see (up to 500 characters).",
  note: "Keep the internal note under 1,000 characters.",
};

/**
 * One review decision behind a dialog: what happens, an optional reason the
 * member sees, an optional internal note, then the routine's answer. Buttons
 * only describe what the database will allow; the routine decides, so a stale
 * page or a forged request gets a clear message instead of a change.
 */
export function ReviewActionDialog({
  action,
  hidden,
  icon,
  label,
  title,
  description,
  reason,
  note = true,
  submitLabel,
  successText,
  variant = "outline",
  disabled,
  hint,
  children,
}: {
  action: (
    previous: ReviewDialogState,
    form: FormData
  ) => Promise<ReviewDialogState>;
  hidden: Record<string, string>;
  /** A rendered icon (`<BadgeCheck />`): server pages render this client dialog. */
  icon: ReactElement;
  label: string;
  title: string;
  description: string;
  /** A member-facing reason: its label, and whether it is required. */
  reason?: { label: string; required: boolean; name?: string };
  note?: boolean;
  submitLabel?: string;
  successText: string;
  variant?: "default" | "outline" | "destructive";
  disabled?: boolean;
  hint?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [state, run, pending] = useActionState(
    async (previous: ReviewDialogState, form: FormData) => {
      const result = await action(previous, form);
      if (result?.code === "SUCCESS") {
        toast.success(successText);
        setOpen(false);
        setReasonText("");
        router.refresh();
      }
      return result;
    },
    null
  );
  const problem =
    state && state.code !== "SUCCESS"
      ? state.code === "VALIDATION_ERROR" && state.field
        ? (FIELD_MESSAGES[state.field] ?? verificationMessage(state.code))
        : verificationMessage(state.code)
      : null;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant={variant}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {icon}
        {label}
      </Button>
      {hint ? (
        <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <form action={run} className="grid gap-4" aria-busy={pending}>
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {children}
            {reason ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-reason`}>{reason.label}</Label>
                <Textarea
                  id={`${id}-reason`}
                  name={reason.name ?? "reason"}
                  value={reasonText}
                  onChange={(event) => setReasonText(event.target.value)}
                  maxLength={500}
                  rows={3}
                  required={reason.required}
                  aria-describedby={`${id}-reason-hint`}
                  aria-invalid={
                    state?.field === "reason" ||
                    state?.field === "rejectionReason"
                  }
                />
                <p
                  id={`${id}-reason-hint`}
                  className="text-xs text-muted-foreground"
                >
                  Shown to the member on their profile.{" "}
                  {500 - reasonText.length} characters left.
                </p>
              </div>
            ) : null}
            {note ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-note`}>Internal note (optional)</Label>
                <Textarea
                  id={`${id}-note`}
                  name="note"
                  maxLength={1000}
                  rows={2}
                  aria-describedby={`${id}-note-hint`}
                />
                <p
                  id={`${id}-note-hint`}
                  className="text-xs text-muted-foreground"
                >
                  Reviewers only. Never shown to the member.
                </p>
              </div>
            ) : null}
            {problem ? (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={variant === "destructive" ? "destructive" : "default"}
                disabled={
                  pending || (reason?.required === true && !reasonText.trim())
                }
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {submitLabel ?? label}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
