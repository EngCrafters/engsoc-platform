"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MailCheck, TriangleAlert, Zap } from "lucide-react";
import { setAccountActivationAction } from "./actions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ACCOUNT_ACTIVATION_LABELS,
  membershipMessage,
} from "@/lib/membership/labels";
import type { AccountActivation } from "@/lib/membership/types";

const ICONS = { email_confirmation: MailCheck, immediate: Zap } as const;

/**
 * How registrants' accounts are created (ADR 0030), separate from the approval policy. Holders
 * of the membership settings permission change it; the database checks that permission again and
 * audits every change. Immediate activation needs Core's service-role key; without it the option
 * is unavailable and registrations use email confirmation.
 */
export function AccountActivationForm({
  current,
  canCreateAccounts,
}: {
  current: AccountActivation;
  canCreateAccounts: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    setAccountActivationAction,
    null
  );
  const [choice, setChoice] = useState<AccountActivation>(current);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.code === "SUCCESS") {
      toast.success("Account activation saved", { id: "account-activation" });
      router.refresh();
    } else if (state?.code) feedback.current?.focus();
  }, [router, state]);

  const unchanged = choice === current;
  const chosen = ACCOUNT_ACTIVATION_LABELS[choice];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account activation</CardTitle>
        <CardDescription>
          How a registrant&apos;s sign-in account is created. This is separate
          from the approval policy above, which decides membership. Every change
          is audited.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form id="account-activation-form" action={action}>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Account activation</legend>
            {(["email_confirmation", "immediate"] as const).map((mode) => {
              const Icon = ICONS[mode];
              const unavailable = mode === "immediate" && !canCreateAccounts;
              return (
                <label
                  key={mode}
                  className="flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50 has-checked:border-primary has-checked:bg-primary/5 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:ring-2 has-focus-visible:ring-ring"
                >
                  <input
                    type="radio"
                    name="accountActivation"
                    value={mode}
                    checked={choice === mode}
                    disabled={unavailable || pending}
                    onChange={() => setChoice(mode)}
                    className="mt-1 size-4 accent-primary"
                    aria-describedby={`account-activation-${mode}`}
                  />
                  <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <Icon aria-hidden="true" className="size-4" />
                      {ACCOUNT_ACTIVATION_LABELS[mode].title}
                      {current === mode ? (
                        <Badge variant="secondary">Current</Badge>
                      ) : null}
                    </span>
                    <span
                      id={`account-activation-${mode}`}
                      className="text-sm text-muted-foreground"
                    >
                      {ACCOUNT_ACTIVATION_LABELS[mode].description}
                      {unavailable
                        ? " Unavailable on this server: Core needs its server-side Supabase service-role key to create accounts."
                        : null}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </form>

        {current === "immediate" && !canCreateAccounts ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Registrations are using email confirmation</AlertTitle>
            <AlertDescription>
              Immediate activation is selected, but this server cannot create
              accounts without its service-role key, so registrants receive a
              confirmation email instead.
            </AlertDescription>
          </Alert>
        ) : null}

        {choice === "immediate" ? (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>The email address is not verified</AlertTitle>
            <AlertDescription>
              Anyone can register an address they do not own and get a member
              account for it. The real owner can take the account back with
              &ldquo;Forgot password&rdquo;. Addresses that already have an
              account are never affected, and registration still grants no
              administrative access.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" disabled={pending || unchanged}>
                Save account activation
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Switch to {chosen.title.toLowerCase()}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {chosen.description} It applies to registrations from now on;
                  existing accounts and applications do not change.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction type="submit" form="account-activation-form">
                  Save
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {state?.code && state.code !== "SUCCESS" ? (
          <div ref={feedback} tabIndex={-1} className="outline-none">
            <Alert variant="destructive">
              <AlertTitle>The setting was not changed</AlertTitle>
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
