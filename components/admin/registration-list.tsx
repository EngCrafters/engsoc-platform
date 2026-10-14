import type { ReactNode } from "react";
import { CircleCheck, Users } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AdminRegistration,
  AdminRegistrationStatus,
} from "@/lib/admin-registrations/types";

const cell = "group-data-[density=compact]/admin:py-1.5";

/** Attendee table for one registration status; waitlisted rows get a promote action. */
export function RegistrationList({
  status,
  registrations,
  renderPromote,
}: {
  status: AdminRegistrationStatus;
  registrations: AdminRegistration[];
  renderPromote: (registrationId: string) => ReactNode;
}) {
  if (registrations.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No registrations yet"
        description={
          status === "waitlisted"
            ? "There are no waitlisted registrations for this event."
            : "There are no confirmed registrations for this event."
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Attendee</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead className="hidden md:table-cell">Registered</TableHead>
            <TableHead className="text-right">
              {status === "waitlisted" ? "Action" : "Status"}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {registrations.map((registration) => {
            const registered = new Date(
              registration.registeredAt
            ).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            });
            return (
              <TableRow key={registration.id}>
                <TableCell
                  className={`${cell} w-full max-w-0 whitespace-normal md:w-auto md:max-w-none md:min-w-52`}
                >
                  <p className="truncate font-medium">
                    {registration.attendeeName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {registration.attendeeEmail}
                  </p>
                  {/* Below md the phone lives under the attendee rather than in
                      its own column, so a narrow screen does not have to scroll
                      sideways to read it. */}
                  <p className="text-xs text-muted-foreground md:hidden">
                    {registration.attendeePhone ?? "Phone not captured"}
                  </p>
                  <p className="text-xs text-muted-foreground md:hidden">
                    Registered {registered}
                  </p>
                </TableCell>
                <TableCell
                  className={`${cell} hidden whitespace-nowrap text-muted-foreground md:table-cell`}
                >
                  {registration.attendeePhone ?? (
                    // A registration captured before the phone field existed.
                    // Saying so is the honest answer; a blank cell would read as
                    // a rendering bug and a dash as missing data.
                    <span className="italic">Not captured</span>
                  )}
                </TableCell>
                <TableCell
                  className={`${cell} hidden text-muted-foreground md:table-cell`}
                >
                  {registered}
                </TableCell>
                <TableCell className={`${cell} text-right`}>
                  {status === "waitlisted" ? (
                    renderPromote(registration.id)
                  ) : (
                    <Badge variant="secondary">
                      <CircleCheck
                        aria-hidden="true"
                        data-icon="inline-start"
                      />
                      Confirmed
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
