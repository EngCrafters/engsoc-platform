import { DatabaseZap } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Shown on the membership pages, to the roles the membership rules name, when
 * the database cannot confirm review access. It names no applicant and grants
 * nothing; the server log carries the database error code.
 */
export function MembershipUnavailable({
  reason,
}: {
  reason: "setup-required" | "database-error";
}) {
  return (
    <section
      aria-labelledby="membership-unavailable-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        title="Membership applications"
        headingId="membership-unavailable-title"
      />
      <Alert variant={reason === "setup-required" ? "default" : "destructive"}>
        <DatabaseZap aria-hidden="true" />
        {reason === "setup-required" ? (
          <>
            <AlertTitle>Membership review needs setup</AlertTitle>
            <AlertDescription>
              This environment&rsquo;s database does not have the membership
              tables yet (migration 0025_membership_applications). Ask the
              Technical Team to apply it. The rest of the dashboard is not
              affected.
            </AlertDescription>
          </>
        ) : (
          <>
            <AlertTitle>Membership review is unavailable right now</AlertTitle>
            <AlertDescription>
              The database could not confirm your membership review access. Try
              again in a moment; if it continues, contact the Technical Team.
            </AlertDescription>
          </>
        )}
      </Alert>
    </section>
  );
}
