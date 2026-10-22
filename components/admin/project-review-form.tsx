"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { reviewProject } from "@/app/admin/(protected)/projects/actions";
export function ProjectReviewForm({
  id,
  revision,
  status,
  publishedRevision,
  isAuthor,
}: {
  id: string;
  revision: number;
  status: string;
  publishedRevision: number | null;
  isAuthor: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const [attest, setAttest] = useState(false);
  const [state, action, pending] = useActionState(reviewProject, { code: "" });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      {state.code && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm"
        >
          {state.code === "SELF_REVIEW"
            ? "You cannot review a project you contributed to. Confirm the no-conflict declaration before approval."
            : state.code === "STALE_REVISION"
              ? "This revision changed. Review the current details before trying again."
              : state.code === "VALIDATION_ERROR"
                ? "Provide feedback when rejecting or requesting changes (maximum 2,000 characters)."
                : "This decision could not be saved. Check the current project status and try again."}
        </p>
      )}
      {status === "under_review" && (
        <>
          <label className="block text-sm">
            Feedback to member
            <textarea
              name="feedback"
              value={feedback}
              disabled={pending}
              onChange={(e) => setFeedback(e.target.value)}
              maxLength={2000}
              rows={4}
              className="mt-2 block w-full rounded-md border bg-background p-3"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Required when rejecting or requesting changes. Saved decisions
            appear in the member’s project history.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              name="attest"
              type="checkbox"
              checked={attest}
              disabled={pending}
              onChange={(e) => setAttest(e.target.checked)}
              className="mt-1"
            />
            I did not contribute to this project and have no conflict of
            interest.
          </label>
        </>
      )}
      {["draft", "changes_requested", "rejected"].includes(status) && (
        <p className="text-sm text-muted-foreground">
          This revision is with the member. Review starts after they submit it.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {status === "submitted" && (
          <Button
            name="operation"
            value="start_review"
            disabled={pending || isAuthor}
          >
            Start review
          </Button>
        )}
        {status === "under_review" && (
          <>
            <Button
              name="operation"
              value="approve"
              disabled={pending || isAuthor}
            >
              Approve revision
            </Button>
            <Button
              name="operation"
              value="request_changes"
              variant="outline"
              disabled={pending || isAuthor}
            >
              Request changes
            </Button>
            <Button
              name="operation"
              value="reject"
              variant="destructive"
              disabled={pending || isAuthor}
            >
              Reject
            </Button>
          </>
        )}
        {status === "approved" && publishedRevision !== revision && (
          <Button
            name="operation"
            value="publish"
            disabled={pending || isAuthor}
          >
            Publish approved revision
          </Button>
        )}
        {publishedRevision && (
          <Button
            name="operation"
            value="unpublish"
            variant="outline"
            disabled={pending}
          >
            Unpublish
          </Button>
        )}
      </div>
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving decision…
        </p>
      )}
    </form>
  );
}
