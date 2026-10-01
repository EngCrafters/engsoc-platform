import { notFound } from "next/navigation";
import { CircleAlert, Inbox, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { FormActions, FormField } from "@/components/ui/form-field";
import { StatePanel } from "@/components/ui/state-panel";
import { AmbientGlow } from "@/components/ui/ambient-glow";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dev-only design-system reference. Never a production route — 404s
 * outside development so it can't ship as a reachable URL. See
 * docs/DESIGN_SYSTEM.md.
 */
export default function DesignSystemShowcasePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-5xl space-y-12 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Design system
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dev-only reference. Not part of the production App Router output.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Typography
        </h2>
        <div className="space-y-2">
          <p className="text-3xl font-semibold tracking-[-0.04em]">
            Display / page title
          </p>
          <p className="text-lg font-semibold tracking-tight">Section title</p>
          <p className="text-base font-medium">Card title</p>
          <p className="text-sm">Body text, 400 weight by default.</p>
          <p className="text-xs text-muted-foreground">Small body / caption</p>
          <p className="text-xs font-medium uppercase tracking-wide">Label</p>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Status colors
        </h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="primary-soft">Draft</Badge>
          <Badge variant="success">Published</Badge>
          <Badge variant="warning">In review</Badge>
          <Badge variant="danger">Cancelled</Badge>
          <Badge variant="full">Full</Badge>
          <Badge variant="quiet">Archived</Badge>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Buttons
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Card variants
        </h2>
        <p className="text-xs text-muted-foreground">
          Hover the &quot;interactive&quot; card. &quot;glass&quot; needs an{" "}
          <code>AmbientGlow</code> (or similar) behind it, shown here.
        </p>
        <div className="relative overflow-hidden rounded-xl p-4">
          <AmbientGlow />
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              ["default", "subtle", "elevated", "interactive", "glass"] as const
            ).map((variant) => (
              <Card key={variant} variant={variant}>
                <CardHeader>
                  <CardTitle className="capitalize">{variant}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Card variant=&quot;{variant}&quot;
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Form field
        </h2>
        <Card className="max-w-md">
          <CardContent className="grid gap-4">
            <FormField htmlFor="demo-email" label="Email address" required>
              <Input id="demo-email" type="email" />
            </FormField>
            <FormField
              htmlFor="demo-password"
              label="Password"
              description="At least 12 characters."
            >
              <Input id="demo-password" type="password" />
            </FormField>
            <FormField
              htmlFor="demo-name"
              label="Name"
              error="Name is required."
            >
              <Input id="demo-name" aria-invalid />
            </FormField>
            <FormActions>
              <Button type="button">Submit</Button>
            </FormActions>
          </CardContent>
        </Card>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Feedback states
        </h2>
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

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Loading
        </h2>
        <div className="flex flex-wrap items-center gap-6">
          <Button disabled>
            <Spinner />
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

      <Separator />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Auth icon treatment
        </h2>
        <span className="inline-flex size-9 items-center justify-center rounded-full border border-foreground/15 text-foreground/70">
          <LockKeyhole aria-hidden="true" className="size-4" />
        </span>
      </section>
    </main>
  );
}
