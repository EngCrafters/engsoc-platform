"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  createCommitteeAction,
  updateCommitteeAction,
  type AdminActionState,
} from "../actions";

const initial: AdminActionState = { status: "idle" };

/** "Media Team" → "media-team": a suggestion only; the identifier never changes after creation. */
const suggestSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Create a committee, or edit one's name and description. The identifier is fixed. */
export function CommitteeFormDialog({
  committee,
}: {
  committee?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
}) {
  const editing = Boolean(committee);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(committee?.name ?? "");
  const [slug, setSlug] = useState(committee?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: AdminActionState, form: FormData) => {
      const result = await (
        editing ? updateCommitteeAction : createCommitteeAction
      )(previous, form);
      if (result.status === "success") {
        toast.success(result.message);
        setOpen(false);
        if (!editing && result.id)
          router.push(`/admin/administration/committees/${result.id}`);
        else router.refresh();
      }
      return result;
    },
    initial
  );

  return (
    <>
      <Button
        variant={editing ? "outline" : "default"}
        onClick={() => setOpen(true)}
      >
        {editing ? (
          <Pencil data-icon="inline-start" aria-hidden="true" />
        ) : (
          <Plus data-icon="inline-start" aria-hidden="true" />
        )}
        {editing ? "Edit details" : "New committee"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit committee" : "New committee"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "The name and description can change. The identifier stays, so events, projects and access keep working."
                : "A committee starts with no managers. Assign them afterwards from its page."}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            {committee ? (
              <input type="hidden" name="committeeId" value={committee.id} />
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="committee-name">Name</Label>
              <Input
                id="committee-name"
                name="name"
                value={name}
                maxLength={80}
                required
                aria-invalid={
                  state.status === "error" && state.field === "name"
                }
                onChange={(event) => {
                  setName(event.target.value);
                  if (!editing && !slugTouched)
                    setSlug(suggestSlug(event.target.value));
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="committee-slug">Identifier</Label>
              <Input
                id="committee-slug"
                name="slug"
                value={slug}
                maxLength={40}
                readOnly={editing}
                aria-readonly={editing}
                aria-describedby="committee-slug-hint"
                aria-invalid={
                  state.status === "error" && state.field === "slug"
                }
                className="font-mono"
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
              />
              <p
                id="committee-slug-hint"
                className="text-xs text-muted-foreground"
              >
                {editing
                  ? "Fixed: other records refer to the committee by it."
                  : "Lowercase letters, digits and hyphens. It cannot be changed later."}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="committee-description">Responsibilities</Label>
              <Textarea
                id="committee-description"
                name="description"
                defaultValue={committee?.description ?? ""}
                maxLength={1000}
                rows={4}
                placeholder="What this committee is responsible for"
              />
            </div>
            {state.status === "error" ? (
              <p role="alert" className="text-sm text-destructive">
                {state.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  pending ||
                  name.trim().length < 2 ||
                  (!editing && slug.length < 2)
                }
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {pending
                  ? "Saving…"
                  : editing
                    ? "Save details"
                    : "Create committee"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
