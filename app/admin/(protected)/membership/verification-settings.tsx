"use client";

import { useActionState, useId } from "react";
import { useRouter } from "next/navigation";
import { Settings2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { verificationMessage } from "@/lib/verification/labels";
import type { VerificationSettings } from "@/lib/verification/types";
import {
  saveVerificationSettingsAction,
  setPositionLimitAction,
  type ReviewActionState,
} from "./verification-actions";

const FIELD_HINTS: Record<string, string> = {
  squSubmissionsPer30Days: "Use a whole number from 1 to 20.",
  documentRetentionDays:
    "Leave empty to keep evidence (not configured), or use 30 to 3,650 days.",
  leadershipRequestsPer30Days: "Use a whole number from 1 to 50.",
  maxActiveAppointmentsPerMember:
    "Leave empty for no limit, or use 1 to 20. Zero is not accepted.",
  maxHolders: "Leave empty for no limit, or use 1 to 50. Zero is not accepted.",
};

function useSaved(
  action: (
    previous: ReviewActionState,
    form: FormData
  ) => Promise<ReviewActionState>,
  success: string
) {
  const router = useRouter();
  return useActionState(async (previous: ReviewActionState, form: FormData) => {
    const result = await action(previous, form);
    if (result?.code === "SUCCESS") {
      toast.success(success);
      router.refresh();
    } else if (result?.code === "UNCHANGED") toast.info("Nothing changed.");
    return result;
  }, null);
}

const problemOf = (state: ReviewActionState) =>
  state &&
  state.code !== "SUCCESS" &&
  state.code !== "UNCHANGED" &&
  state.code !== "RETENTION_CONFIRMATION_REQUIRED"
    ? state.field
      ? (FIELD_HINTS[state.field] ?? verificationMessage(state.code))
      : verificationMessage(state.code)
    : null;

/** What an empty value means for each field: "No limit" and "Not configured" are different things. */
const emptyMeaning = (name: string) =>
  name === "documentRetentionDays"
    ? "Not configured: evidence is kept until a period is set."
    : "No limit.";

/**
 * The limits and the evidence retention period of ADR 0025, editable by holders of
 * settings.verification (ADR 0027; initially Board Administration, Technical and Society
 * Affairs). Every change is validated and audited by the database. Lowering a limit never ends an
 * appointment, and saving a retention period never deletes anything by itself.
 */
export function VerificationSettingsCard({
  settings,
  editable,
}: {
  settings: VerificationSettings;
  editable: boolean;
}) {
  const id = useId();
  const [state, save, saving] = useSaved(
    saveVerificationSettingsAction,
    "Settings saved"
  );
  const problem = problemOf(state);
  const needsConfirmation = state?.code === "RETENTION_CONFIRMATION_REQUIRED";
  const fields = [
    {
      name: "squSubmissionsPer30Days",
      label: "SQU submissions per member in 30 days",
      value: settings.squSubmissionsPer30Days,
      min: 1,
      max: 20,
      required: true,
    },
    {
      name: "documentRetentionDays",
      label: "Keep decided SQU evidence for (days)",
      value: settings.documentRetentionDays,
      min: 30,
      max: 3650,
      required: false,
      placeholder: "Not configured",
    },
    {
      name: "leadershipRequestsPer30Days",
      label: "Leadership requests per member in 30 days",
      value: settings.leadershipRequestsPer30Days,
      min: 1,
      max: 50,
      required: true,
    },
    {
      name: "maxActiveAppointmentsPerMember",
      label: "Active appointments per member",
      value: settings.maxActiveAppointmentsPerMember,
      min: 1,
      max: 20,
      required: false,
      placeholder: "No limit",
    },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 aria-hidden="true" className="size-4" />
          Verification and leadership settings
        </CardTitle>
        <CardDescription>
          {editable
            ? "Changes apply at once and are recorded in the audit. Existing appointments and stored evidence are never removed by saving."
            : "Changed by people with the Verification and leadership settings permission, initially Board Administration, Technical and Society Affairs."}
          {settings.updatedAt
            ? ` Last changed ${new Date(settings.updatedAt).toLocaleDateString("en-GB", { timeZone: "Asia/Muscat" })}${settings.updatedByEmail ? ` by ${settings.updatedByEmail}` : ""}.`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form action={save} className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.name} className="grid gap-1.5">
              <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
              <Input
                id={`${id}-${field.name}`}
                name={field.name}
                type="number"
                inputMode="numeric"
                min={field.min}
                max={field.max}
                step={1}
                required={field.required}
                defaultValue={field.value ?? ""}
                placeholder={
                  "placeholder" in field ? field.placeholder : undefined
                }
                readOnly={!editable}
                aria-invalid={state?.field === field.name}
                aria-describedby={`${id}-${field.name}-hint`}
              />
              <p
                id={`${id}-${field.name}-hint`}
                className="text-xs text-muted-foreground"
              >
                {field.required
                  ? `Currently ${field.value}.`
                  : field.value === null
                    ? `Currently empty. ${emptyMeaning(field.name)}`
                    : `Currently ${field.value}. Empty means: ${emptyMeaning(field.name).toLowerCase()}`}
              </p>
            </div>
          ))}
          {editable ? (
            <div className="flex flex-col items-start gap-3 sm:col-span-2">
              {problem ? (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              ) : null}
              {needsConfirmation ? (
                <Alert variant="destructive" className="max-w-2xl">
                  <TriangleAlert aria-hidden="true" />
                  <AlertTitle>Confirm the retention period</AlertTitle>
                  <AlertDescription>
                    {state?.eligible ?? 0} stored evidence file
                    {state?.eligible === 1 ? " was" : "s were"} decided longer
                    ago than this period. They will become eligible for
                    deletion, and the next visit to SQU verification by a
                    reviewer removes them. Nothing is deleted by saving.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {needsConfirmation ? (
                  <Button
                    type="submit"
                    name="confirmRetention"
                    value="true"
                    variant="destructive"
                    disabled={saving}
                  >
                    {saving ? <Spinner data-icon="inline-start" /> : null}
                    Confirm and save
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  variant={needsConfirmation ? "outline" : "default"}
                  disabled={saving}
                >
                  {saving && !needsConfirmation ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {needsConfirmation ? "Check again" : "Save settings"}
                </Button>
              </div>
            </div>
          ) : null}
        </form>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Holders per position</h3>
          <p className="text-sm text-muted-foreground">
            Committee level is the committee&apos;s own Chief and Assistant
            Chief; team level applies to each team separately. Lowering a limit
            keeps every current holder; it applies to new appointments.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Position
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Committee level
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Per team
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {settings.positions.map((position) => (
                  <tr key={position.id}>
                    <th scope="row" className="py-2 pr-4 font-medium">
                      {position.label.en}
                    </th>
                    <td className="py-2 pr-4 align-top">
                      <PositionLimit
                        position={position}
                        level="committee"
                        value={position.maxHoldersPerCommittee ?? null}
                        editable={editable}
                      />
                    </td>
                    <td className="py-2 align-top">
                      <PositionLimit
                        position={position}
                        level="team"
                        value={position.maxHolders}
                        editable={editable}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PositionLimit({
  position,
  level,
  value,
  editable,
}: {
  position: VerificationSettings["positions"][number];
  level: "team" | "committee";
  value: number | null;
  editable: boolean;
}) {
  const id = useId();
  const [state, save, saving] = useSaved(
    setPositionLimitAction,
    `${position.label.en} limit saved`
  );
  const problem = problemOf(state);
  const label = `${position.label.en}, ${level === "team" ? "per team" : "committee level"}`;
  return (
    <form action={save} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="position" value={position.id} />
      <input type="hidden" name="level" value={level} />
      <div className="grid gap-1">
        <Label htmlFor={`${id}-max`} className="sr-only">
          {label}
        </Label>
        <Input
          id={`${id}-max`}
          name="maxHolders"
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          step={1}
          defaultValue={value ?? ""}
          placeholder="No limit"
          readOnly={!editable}
          className="w-28"
          aria-invalid={Boolean(problem)}
        />
      </div>
      {editable ? (
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={saving}
          aria-label={`Save ${label}`}
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      ) : null}
      {problem ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
