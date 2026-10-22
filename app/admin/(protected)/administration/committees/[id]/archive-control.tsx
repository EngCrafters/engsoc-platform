"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
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
import { Spinner } from "@/components/ui/spinner";
import { archiveCommitteeAction, type AdminActionState } from "../../actions";

const initial: AdminActionState = { status: "idle" };

/** Archive (keeping every record) or restore a committee. */
export function ArchiveControl({
  committeeId,
  name,
  archived,
  protectedCommittee,
}: {
  committeeId: string;
  name: string;
  archived: boolean;
  protectedCommittee: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: AdminActionState, form: FormData) => {
      const result = await archiveCommitteeAction(previous, form);
      if (result.status === "success") {
        toast.success(result.message);
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    initial
  );
  if (protectedCommittee && !archived) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {archived ? (
          <ArchiveRestore data-icon="inline-start" aria-hidden="true" />
        ) : (
          <Archive data-icon="inline-start" aria-hidden="true" />
        )}
        {archived ? "Restore" : "Archive"}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archived ? `Restore ${name}?` : `Archive ${name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? "The committee can take new events, managers and members again."
                : "Its events, projects, access history and roster stay exactly as they are. It stops taking new events, managers and members until restored. Active managers and upcoming live events must be moved or archived first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={action} className="contents">
            <input type="hidden" name="committeeId" value={committeeId} />
            <input type="hidden" name="archived" value={String(!archived)} />
            {state.status === "error" ? (
              <p role="alert" className="text-sm text-destructive">
                {state.message}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {archived ? "Restore committee" : "Archive committee"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
