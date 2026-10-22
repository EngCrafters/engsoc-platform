import { UserPen } from "lucide-react";
import type { ProfileChangeRequest } from "@/lib/members/profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideCorrectionAction } from "./correction-actions";

const FIELD_LABELS: Record<ProfileChangeRequest["field"], string> = {
  full_name: "Full name",
  university_id: "Student ID",
};

/**
 * Members ask for corrections to verified fields (name, student ID) from their profile
 * (ADR 0023). A reviewer checks the request against the SQU ID card on file and decides; the
 * member's own requests are shown but cannot be decided by them.
 */
export function ProfileCorrections({
  requests,
  result,
}: {
  requests: ProfileChangeRequest[];
  result?: string;
}) {
  if (requests.length === 0 && !result) return null;
  return (
    <section
      aria-labelledby="corrections-title"
      className="flex flex-col gap-3 rounded-lg border p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <UserPen aria-hidden="true" className="size-4 text-muted-foreground" />
        <h2 id="corrections-title" className="font-semibold">
          Profile corrections
        </h2>
        <Badge variant="secondary" className="tabular-nums">
          {requests.length} pending
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Members cannot change their verified name or student ID themselves.
        Compare each request with their SQU ID card before approving.
      </p>
      {result ? (
        <p role="status" className="text-sm">
          {result === "SUCCESS"
            ? "Decision saved."
            : result === "CONFLICT"
              ? "Another member already has that student ID; the request is still pending."
              : result === "SELF_REVIEW"
                ? "You cannot decide your own correction."
                : "The decision could not be saved. Refresh and try again."}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y">
        {requests.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <div className="min-w-0 text-sm">
              <p className="font-medium" dir="auto">
                {r.memberName}{" "}
                <span className="font-normal text-muted-foreground">
                  · {r.memberEmail}
                </span>
              </p>
              <p className="mt-1">
                <span className="text-muted-foreground">
                  {FIELD_LABELS[r.field]}:
                </span>{" "}
                <span dir="auto" className="line-through decoration-1">
                  {r.currentValue}
                </span>{" "}
                →{" "}
                <span dir="auto" className="font-medium">
                  {r.requestedValue}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Requested{" "}
                {new Intl.DateTimeFormat("en-GB", {
                  dateStyle: "medium",
                  timeZone: "Asia/Muscat",
                }).format(new Date(r.requestedAt))}
              </p>
            </div>
            {r.isOwn ? (
              <p className="text-xs text-muted-foreground">
                Your own request: another reviewer decides it.
              </p>
            ) : (
              <form
                action={decideCorrectionAction}
                className="flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="request" value={r.id} />
                <Input
                  name="note"
                  maxLength={500}
                  placeholder="Internal note (optional)"
                  aria-label={`Note for ${r.memberName}`}
                  className="h-9 w-56"
                />
                <Button type="submit" name="decision" value="approve" size="sm">
                  Approve
                </Button>
                <Button
                  type="submit"
                  name="decision"
                  value="reject"
                  size="sm"
                  variant="outline"
                >
                  Reject
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
