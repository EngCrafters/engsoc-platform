import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getManagerContext } from "@/lib/auth/manager";
import { getAdminEvent } from "@/lib/admin-events/server";
import {
  countAdminRegistrations,
  listAdminRegistrations,
} from "@/lib/admin-registrations/server";
import {
  decodeRegistrationCursor,
  encodeRegistrationCursor,
} from "@/lib/admin-registrations/cursor";
import { parseRegistrationStatus } from "@/lib/admin-registrations/types";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RegistrationList } from "@/components/admin/registration-list";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PromoteButton } from "./promote-button";

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? undefined : value;
}

export default async function RegistrationsPage({
  params,
  searchParams,
}: PageProps<"/admin/events/[id]/registrations">) {
  const [{ id }, query, manager] = await Promise.all([
    params,
    searchParams,
    getManagerContext(),
  ]);
  if (manager.kind !== "manager") return null;
  const event = await getAdminEvent(manager.userId, id);
  if (!event) notFound();
  const status = parseRegistrationStatus(single(query.status));
  const cursorResult = decodeRegistrationCursor(
    single(query.cursor),
    id,
    status
  );
  const [counts, result] = await Promise.all([
    countAdminRegistrations(manager.userId, id),
    cursorResult.invalid
      ? Promise.resolve({ registrations: [], nextCursor: null })
      : listAdminRegistrations(manager.userId, id, status, cursorResult.cursor),
  ]);
  if (!counts) notFound();
  const nextHref = result.nextCursor
    ? `/admin/events/${id}/registrations?status=${status}&cursor=${encodeRegistrationCursor(result.nextCursor, id, status)}`
    : null;
  return (
    <section
      aria-labelledby="registrations-title"
      className="flex flex-col gap-6"
    >
      <AdminPageHeader
        title={`${event.title} registrations`}
        headingId="registrations-title"
        description="Review private registrations for this event. Waitlist promotion is FIFO and requires contact confirmation."
        context={
          <span className="text-sm text-muted-foreground">
            {event.committeeName}
          </span>
        }
        actions={
          <form
            method="post"
            action={`/admin/events/${id}/registrations/export?status=${status}`}
          >
            <Button type="submit" variant="outline">
              <Download aria-hidden="true" data-icon="inline-start" />
              Export {status}
            </Button>
          </form>
        }
      />
      <Tabs value={status} className="gap-4">
        <TabsList aria-label="Registration status">
          <TabsTrigger value="confirmed" asChild>
            <Link href={`/admin/events/${id}/registrations?status=confirmed`}>
              Confirmed
              <span className="tabular-nums text-muted-foreground">
                {counts.confirmed_count}
              </span>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="waitlisted" asChild>
            <Link href={`/admin/events/${id}/registrations?status=waitlisted`}>
              Waitlisted
              <span className="tabular-nums text-muted-foreground">
                {counts.waitlisted_count}
              </span>
            </Link>
          </TabsTrigger>
        </TabsList>
        <TabsContent value={status} className="flex flex-col gap-4">
          {cursorResult.invalid ? (
            <Alert variant="destructive">
              <AlertTitle>This page link is invalid</AlertTitle>
              <AlertDescription>
                This registration page link is invalid. Return to the first
                page.
              </AlertDescription>
            </Alert>
          ) : null}
          <RegistrationList
            status={status}
            registrations={result.registrations}
            renderPromote={(registrationId) => (
              <PromoteButton eventId={id} registrationId={registrationId} />
            )}
          />
          {nextHref ? (
            <nav
              aria-label="Registration pagination"
              className="flex justify-end"
            >
              <Button asChild variant="outline">
                <Link href={nextHref}>Next page</Link>
              </Button>
            </nav>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
