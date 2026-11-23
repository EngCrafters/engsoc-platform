"use client";

import { useActionState, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck, ShieldOff, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { PERMISSION_AREAS } from "@/lib/auth/permissions";
import type {
  CatalogEntry,
  GroupPermission,
  PermissionGroup,
} from "@/lib/administration/permissions";
import {
  saveGroupPermissionsAction,
  type PermissionActionState,
} from "../../actions";

type Selection = Map<string, "all" | "own">;

const toSet = (selection: Selection, catalog: CatalogEntry[]) =>
  catalog
    .filter((entry) => selection.has(entry.key))
    .map((entry) => ({ key: entry.key, scope: selection.get(entry.key)! }));

const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Muscat" });

/**
 * Edits one group's permissions. The preview shows who is affected and exactly what they will be
 * able to do; granting full access or changing who can manage permissions asks for confirmation,
 * which the database requires too. Saving is refused for a group the editor holds access through.
 */
export function PermissionsEditor({
  kind,
  id,
  groupName,
  committeeName,
  catalog,
  initial,
  holders,
  history,
  self,
}: {
  kind: "committee" | "team";
  id: string;
  groupName: string;
  committeeName: string;
  catalog: CatalogEntry[];
  initial: GroupPermission[];
  holders: PermissionGroup["holders"];
  history: PermissionGroup["history"];
  self: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [selection, setSelection] = useState<Selection>(
    () => new Map(initial.map((p) => [p.key, p.scope]))
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [state, save, saving] = useActionState(
    async (previous: PermissionActionState, form: FormData) => {
      const result = await saveGroupPermissionsAction(previous, form);
      if (result?.code === "SUCCESS") {
        toast.success(result.message);
        router.refresh();
      } else if (result?.code === "UNCHANGED") toast.info(result.message);
      else if (result) toast.error(result.message);
      return result;
    },
    null
  );

  const labels = useMemo(
    () => new Map(catalog.map((entry) => [entry.key, entry])),
    [catalog]
  );
  const next = toSet(selection, catalog);
  const before = new Map(initial.map((p) => [p.key, p.scope]));
  const added = next.filter((p) => !before.has(p.key));
  const removed = initial.filter((p) => !selection.has(p.key));
  const rescoped = next.filter(
    (p) => before.has(p.key) && before.get(p.key) !== p.scope
  );
  const changed = added.length + removed.length + rescoped.length > 0;
  const fullAccess =
    next.length === catalog.length && next.every((p) => p.scope === "all");
  const manageChanged =
    before.has("permissions.manage") !== selection.has("permissions.manage");
  const critical = fullAccess || manageChanged;
  const scopeText = (scope: "all" | "own") =>
    scope === "all" ? "society-wide" : `own committee (${committeeName})`;

  function toggle(key: string, on: boolean) {
    setSelection((current) => {
      const copy = new Map(current);
      if (on) copy.set(key, current.get(key) ?? before.get(key) ?? "all");
      else copy.delete(key);
      return copy;
    });
  }
  function setScope(key: string, scope: "all" | "own") {
    setSelection((current) => new Map(current).set(key, scope));
  }
  function submit(withConfirmation: boolean) {
    setConfirmed(withConfirmation);
    // Let React write the hidden inputs before the form is read.
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  return (
    <div className="grid gap-6 @5xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>
            Tick what {groupName}&apos;s leaders may do. Scopable permissions
            can cover the group&apos;s own committee ({committeeName}) or the
            whole society. Full access includes everything Board Administration
            can do, and more.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {self ? (
            <p
              role="note"
              className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
            >
              You hold access through this {kind}, so you cannot change its
              permissions. Another person with the Manage permissions permission
              must do it.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={self || saving}
              onClick={() =>
                setSelection(
                  new Map(catalog.map((entry) => [entry.key, "all"]))
                )
              }
            >
              <ShieldCheck aria-hidden="true" data-icon="inline-start" />
              Grant full access
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={self || saving || selection.size === 0}
              onClick={() => setSelection(new Map())}
            >
              <ShieldOff aria-hidden="true" data-icon="inline-start" />
              Remove access
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!changed || saving}
              onClick={() =>
                setSelection(new Map(initial.map((p) => [p.key, p.scope])))
              }
            >
              <Undo2 aria-hidden="true" data-icon="inline-start" />
              Undo changes
            </Button>
          </div>
          {PERMISSION_AREAS.map(([area, areaLabel]) => {
            const entries = catalog.filter((entry) => entry.area === area);
            if (entries.length === 0) return null;
            return (
              <fieldset key={area} className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">
                  {areaLabel}
                </legend>
                {entries.map((entry) => {
                  const checked = selection.has(entry.key);
                  const inputId = `${formId}-${entry.key}`;
                  return (
                    <div
                      key={entry.key}
                      className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <input
                          id={inputId}
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                          checked={checked}
                          disabled={self || saving}
                          onChange={(event) =>
                            toggle(entry.key, event.target.checked)
                          }
                          aria-describedby={`${inputId}-description`}
                        />
                        <div className="min-w-0">
                          <Label htmlFor={inputId} className="font-medium">
                            {entry.label}
                          </Label>
                          <p
                            id={`${inputId}-description`}
                            className="text-sm text-muted-foreground"
                          >
                            {entry.description}
                          </p>
                        </div>
                      </div>
                      {entry.scopable && checked ? (
                        <div className="flex shrink-0 flex-col gap-1 sm:items-end">
                          <Label
                            htmlFor={`${inputId}-scope`}
                            className="text-xs text-muted-foreground"
                          >
                            Applies to
                          </Label>
                          <select
                            id={`${inputId}-scope`}
                            className="h-8 rounded-md border bg-background px-2 text-sm"
                            value={selection.get(entry.key)}
                            disabled={self || saving}
                            onChange={(event) =>
                              setScope(
                                entry.key,
                                event.target.value === "own" ? "own" : "all"
                              )
                            }
                          >
                            <option value="own">Own committee</option>
                            <option value="all">All committees</option>
                          </select>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
          <form
            ref={formRef}
            action={save}
            className="flex flex-col gap-3 border-t pt-4"
          >
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <input
              type="hidden"
              name="permissions"
              value={JSON.stringify(next)}
            />
            <input
              type="hidden"
              name="previous"
              value={JSON.stringify(initial)}
            />
            <input
              type="hidden"
              name="confirmed"
              value={confirmed ? "true" : "false"}
            />
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-note`}>
                Note for the audit (optional)
              </Label>
              <Textarea
                id={`${formId}-note`}
                name="note"
                maxLength={500}
                rows={2}
                disabled={self}
                placeholder="Why this change is made"
              />
            </div>
            {state && state.code !== "SUCCESS" && state.code !== "UNCHANGED" ? (
              <p role="alert" className="text-sm text-destructive">
                {state.message}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                disabled={self || saving || !changed}
                onClick={() =>
                  critical ? setConfirmOpen(true) : submit(false)
                }
              >
                {saving ? <Spinner data-icon="inline-start" /> : null}
                Save permissions
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {holders.length === 0
                ? `Nobody holds access through this ${kind} now. Leaders appointed later receive these permissions.`
                : `${holders.length} ${holders.length === 1 ? "person receives" : "people receive"} these permissions now, on their next page load after saving.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {holders.length ? (
              <ul
                className="flex flex-col divide-y rounded-md border"
                aria-label="Affected people"
              >
                {holders.map((h) => (
                  <li
                    key={`${h.source}-${h.memberId}`}
                    className="flex flex-col px-3 py-2"
                  >
                    <span className="font-medium">{h.name ?? h.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {h.source === "manager"
                        ? "Committee Manager"
                        : (h.position?.label.en ?? "Leader")}
                      {h.name ? ` · ${h.email}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              <p className="mb-1 font-medium">
                {fullAccess
                  ? "Full access, society-wide"
                  : next.length
                    ? "They will be able to"
                    : "No dashboard permissions"}
              </p>
              {!fullAccess && next.length ? (
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {next.map((p) => (
                    <li key={p.key}>
                      {labels.get(p.key)?.label}
                      {labels.get(p.key)?.scopable
                        ? ` (${scopeText(p.scope)})`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {changed ? (
              <div className="rounded-md bg-muted/60 p-3">
                <p className="mb-1 font-medium">Unsaved changes</p>
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {added.map((p) => (
                    <li key={`a-${p.key}`}>Adds {labels.get(p.key)?.label}</li>
                  ))}
                  {rescoped.map((p) => (
                    <li key={`s-${p.key}`}>
                      {labels.get(p.key)?.label}: now {scopeText(p.scope)}
                    </li>
                  ))}
                  {removed.map((p) => (
                    <li key={`r-${p.key}`}>
                      Removes {labels.get(p.key)?.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>
              Every change, with who made it and the permissions before and
              after.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes yet.</p>
            ) : (
              <ol className="flex flex-col divide-y text-sm">
                {history.map((entry) => {
                  const was = new Set(entry.previous.map((p) => p.key));
                  const now = new Set(entry.next.map((p) => p.key));
                  const plus = entry.next.filter((p) => !was.has(p.key));
                  const minus = entry.previous.filter((p) => !now.has(p.key));
                  return (
                    <li
                      key={entry.id}
                      className="flex flex-col gap-0.5 py-2 first:pt-0"
                    >
                      <span className="font-medium">
                        {entry.previous.length} → {entry.next.length}{" "}
                        permissions
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {entry.actorEmail ?? "Unknown"} · {when(entry.at)}
                      </span>
                      {plus.length ? (
                        <span className="text-xs">
                          Added:{" "}
                          {plus
                            .map((p) => labels.get(p.key)?.label ?? p.key)
                            .join(", ")}
                        </span>
                      ) : null}
                      {minus.length ? (
                        <span className="text-xs">
                          Removed:{" "}
                          {minus
                            .map((p) => labels.get(p.key)?.label ?? p.key)
                            .join(", ")}
                        </span>
                      ) : null}
                      {entry.note ? (
                        <span className="text-xs text-muted-foreground">
                          Note: {entry.note}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert
                aria-hidden="true"
                className="size-5 text-destructive"
              />
              {fullAccess
                ? `Grant full access to ${groupName}?`
                : "Change who can manage permissions?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {fullAccess
                ? `Every permission, society-wide: accounts and administrator access, settings, deletions, the Email Centre and managing other groups' permissions.`
                : selection.has("permissions.manage")
                  ? `${groupName}'s leaders will be able to change any committee's or team's permissions, including granting full access.`
                  : `${groupName}'s leaders will no longer be able to manage permissions.`}{" "}
              {holders.length
                ? `This applies to ${holders.length} ${holders.length === 1 ? "person" : "people"} now.`
                : "Nobody holds access through it yet."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                submit(true);
              }}
            >
              Confirm and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {critical && changed ? (
        <span className="sr-only" role="status">
          Saving this change asks for confirmation.
        </span>
      ) : null}
    </div>
  );
}
