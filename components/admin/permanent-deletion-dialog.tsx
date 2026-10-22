"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  deletePermanentlyAction,
  previewDeletionAction,
  type DeletionKind,
  type DeletionPreview,
} from "@/app/admin/(protected)/administration/deletion-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: DeletionPreview };

const TITLES: Record<DeletionKind, string> = {
  event: "Delete this event permanently?",
  project: "Delete this project permanently?",
  membership: "Delete this membership record?",
  account: "Delete this account completely?",
};

/**
 * The one confirmation for every permanent deletion (ADR 0024): what goes, what stays, what
 * blocks it, then the record's own name typed out (and, for people, the administrator's
 * password). The server re-checks everything; this only makes the consequences legible.
 */
export function PermanentDeletionDialog({
  kind,
  id,
  label = "Delete permanently",
  size = "default",
  openOnMount = false,
  onClosed,
}: {
  kind: DeletionKind;
  id: string;
  label?: string;
  size?: "default" | "sm";
  /** Opened from elsewhere (a menu): no trigger button, open at once. */
  openOnMount?: boolean;
  onClosed?: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpenState] = useState(openOnMount);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) onClosed?.();
  };
  const [state, setState] = useState<State>({ status: "loading" });
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [deleting, startDeleting] = useTransition();

  function load() {
    startLoading(async () => {
      const result = await previewDeletionAction(kind, id);
      setState(
        result.ok
          ? { status: "ready", preview: result.preview }
          : { status: "error", message: result.message }
      );
    });
  }

  function show() {
    setOpen(true);
    setTyped("");
    setPassword("");
    setProblem(null);
    setState({ status: "loading" });
    load();
  }

  useEffect(() => {
    if (openOnMount) load();
    // Loads once for a dialog opened from a menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = state.status === "ready" ? state.preview : null;
  const people = kind === "membership" || kind === "account";
  const matches =
    preview !== null &&
    (people
      ? typed.trim().toLowerCase() === preview.confirmation.toLowerCase()
      : typed.trim() === preview.confirmation.trim());
  const blocked = (preview?.blockers.length ?? 0) > 0;
  const ready =
    preview !== null &&
    !blocked &&
    matches &&
    (!preview.requiresPassword || password.length > 0);

  function submit() {
    if (!ready) return;
    setProblem(null);
    startDeleting(async () => {
      const result = await deletePermanentlyAction(
        kind,
        id,
        typed.trim(),
        password
      );
      setPassword("");
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      if (result.pending) toast.warning(result.message);
      else toast.success(result.message);
      setOpen(false);
      router.push(result.redirectTo);
      router.refresh();
    });
  }

  return (
    <>
      {openOnMount ? null : (
        <Button type="button" variant="destructive" size={size} onClick={show}>
          <Trash2 data-icon="inline-start" aria-hidden="true" />
          {label}
        </Button>
      )}
      <AlertDialog
        open={open}
        onOpenChange={(next) => !deleting && setOpen(next)}
      >
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto data-[size=default]:sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{TITLES[kind]}</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.{" "}
              {kind === "event"
                ? "Archiving stays available if you only want the event off the public site."
                : kind === "project"
                  ? "Unpublishing stays available if you only want it off the public site."
                  : "Review exactly what is removed and kept below."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {state.status === "loading" || loading ? (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner /> Checking everything that depends on this record…
            </p>
          ) : state.status === "error" ? (
            <Alert variant="destructive" role="alert">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>The preview is not available</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex min-w-0 flex-col gap-4 text-sm">
              <p className="font-medium break-words">{state.preview.heading}</p>
              {blocked ? (
                <Alert variant="destructive" role="alert">
                  <TriangleAlert aria-hidden="true" />
                  <AlertTitle>Permanent deletion is blocked</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {state.preview.blockers.map((blocker) => (
                        <li key={blocker.code}>{blocker.message}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <section
                  aria-labelledby={`${ids}-removes`}
                  className="rounded-lg border border-destructive/30 p-3"
                >
                  <h3
                    id={`${ids}-removes`}
                    className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-destructive uppercase"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" /> Deleted
                  </h3>
                  <dl className="flex flex-col gap-2">
                    {state.preview.removes.map((item) => (
                      <div key={item.label}>
                        <dt className="text-xs text-muted-foreground">
                          {item.label}
                        </dt>
                        <dd className="break-words">{item.detail}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section
                  aria-labelledby={`${ids}-keeps`}
                  className="rounded-lg border p-3"
                >
                  <h3
                    id={`${ids}-keeps`}
                    className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    <ShieldCheck aria-hidden="true" className="size-3.5" /> Kept
                  </h3>
                  <dl className="flex flex-col gap-2">
                    {state.preview.keeps.map((item) => (
                      <div key={item.label}>
                        <dt className="text-xs text-muted-foreground">
                          {item.label}
                        </dt>
                        <dd className="break-words">{item.detail}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
              {!blocked ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${ids}-confirm`}>
                      {state.preview.confirmationLabel}:{" "}
                      <span className="font-mono text-xs break-all">
                        {state.preview.confirmation}
                      </span>
                    </Label>
                    <Input
                      id={`${ids}-confirm`}
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={typed.length > 0 && !matches}
                    />
                  </div>
                  {state.preview.requiresPassword ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`${ids}-password`}>Your password</Label>
                      <Input
                        id={`${ids}-password`}
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                      />
                      <p className="text-xs text-muted-foreground">
                        Re-entered to confirm it is you. It is checked once and
                        never stored.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {problem ? (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              ) : null}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {blocked ? "Close" : "Cancel"}
            </AlertDialogCancel>
            {preview && !blocked ? (
              <Button
                type="button"
                variant="destructive"
                disabled={!ready || deleting}
                onClick={submit}
              >
                {deleting ? (
                  <Spinner />
                ) : (
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                )}
                {deleting ? "Deleting…" : "Delete permanently"}
              </Button>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
