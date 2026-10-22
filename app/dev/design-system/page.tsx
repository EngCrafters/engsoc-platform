import { notFound } from "next/navigation";
import { CircleAlert, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { FormActions, FormField } from "@/components/ui/form-field";
import { StatePanel } from "@/components/ui/state-panel";
import { EventStatusBadge } from "@/components/admin/event-status-badge";
import { MessageBanner } from "@/components/ui/message-banner";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dev-only design-system reference. Never a production route: it 404s
 * outside development. See docs/DESIGN_SYSTEM.md.
 */
export default function DesignSystemShowcasePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Design system
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dev-only reference. Not part of the production App Router output.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Typography</h2>
        <p className="text-3xl font-semibold tracking-tight">Page title</p>
        <p className="text-lg font-semibold">Section title</p>
        <p className="text-base font-medium">Row title</p>
        <p className="text-sm">Body text, 400 weight.</p>
        <p className="text-xs text-muted-foreground">Metadata</p>
        <p className="text-3xl font-semibold tabular-nums">1,234</p>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Status</h2>
        <div className="flex flex-wrap gap-2">
          <EventStatusBadge status="draft" />
          <EventStatusBadge status="review" />
          <EventStatusBadge status="approved" />
          <EventStatusBadge status="published" />
          <EventStatusBadge status="full" />
          <EventStatusBadge status="past" />
          <EventStatusBadge status="archived" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Buttons</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Metric card</h2>
        <Card size="sm" className="max-w-xs">
          <CardHeader>
            <CardDescription>Total events</CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums">
              24
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Separator />

      <section className="flex max-w-md flex-col gap-4">
        <h2 className="text-lg font-semibold">Form</h2>
        <FormField htmlFor="demo-email" label="Email address" required>
          <Input id="demo-email" type="email" className="h-10" />
        </FormField>
        <FormField
          htmlFor="demo-password"
          label="Password"
          description="At least 8 characters."
        >
          <Input id="demo-password" type="password" className="h-10" />
        </FormField>
        <FormField htmlFor="demo-name" label="Name" error="Name is required.">
          <Input id="demo-name" aria-invalid className="h-10" />
        </FormField>
        <FormActions>
          <Button type="button" className="h-10">
            Submit
          </Button>
        </FormActions>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <MessageBanner tone="success">Saved.</MessageBanner>
          <MessageBanner tone="error">Something went wrong.</MessageBanner>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatePanel
            icon={Inbox}
            title="No events yet"
            description="Create your first event to see it listed here."
          />
          <StatePanel
            icon={CircleAlert}
            title="Couldn't load events"
            description="Your session is still protected. Try again."
            tone="danger"
            role="alert"
          />
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Loading</h2>
        <div className="flex items-center gap-4">
          <Button disabled>
            <Spinner data-icon="inline-start" />
            Saving…
          </Button>
          <Spinner className="size-6" />
        </div>
        <div className="grid max-w-sm gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </section>
    </main>
  );
}
