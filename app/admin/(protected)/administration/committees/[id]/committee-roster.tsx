"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Pencil,
  Search,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  rosterAction,
  searchMembersAction,
  type AdminActionState,
} from "../../actions";

export type RosterMember = {
  memberId: string;
  name: string;
  email: string;
  universityId: string;
  discipline: string | null;
  year: number | null;
  responsibility: string | null;
};

const initial: AdminActionState = { status: "idle" };

function useRosterChange(onDone?: () => void) {
  const router = useRouter();
  const [, action, pending] = useActionState(
    async (previous: AdminActionState, form: FormData) => {
      const result = await rosterAction(previous, form);
      if (result.status === "success") {
        toast.success(result.message);
        onDone?.();
        router.refresh();
      } else if (result.status === "error") toast.error(result.message);
      return result;
    },
    initial
  );
  return { action, pending };
}

/**
 * The society members on a committee and what each is responsible for. Membership of the
 * roster is informational: it grants no dashboard access.
 */
export function CommitteeRoster({
  committeeId,
  archived,
  members,
}: {
  committeeId: string;
  archived: boolean;
  members: RosterMember[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {archived ? (
        <p className="text-sm text-muted-foreground">
          Archived committees keep their roster but take no changes.
        </p>
      ) : (
        <AddMember
          committeeId={committeeId}
          existing={new Set(members.map((m) => m.memberId))}
        />
      )}
      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members on this committee"
          description="Search the member directory above to add the first one."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[40rem]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Student ID</TableHead>
                <TableHead>Responsibility</TableHead>
                <TableHead className="w-px">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <RosterRow
                  key={member.memberId}
                  committeeId={committeeId}
                  member={member}
                  archived={archived}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function RosterRow({
  committeeId,
  member,
  archived,
}: {
  committeeId: string;
  member: RosterMember;
  archived: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const save = useRosterChange(() => setEditing(false));
  const remove = useRosterChange();
  return (
    <TableRow>
      <TableCell className="max-w-64">
        <span className="block truncate font-medium">{member.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {member.email}
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs">{member.universityId}</TableCell>
      <TableCell className="min-w-56">
        {editing ? (
          <form action={save.action} className="flex items-center gap-2">
            <input type="hidden" name="committeeId" value={committeeId} />
            <input type="hidden" name="memberId" value={member.memberId} />
            <input type="hidden" name="operation" value="update" />
            <Label htmlFor={`resp-${member.memberId}`} className="sr-only">
              Responsibility for {member.name}
            </Label>
            <Input
              id={`resp-${member.memberId}`}
              name="responsibility"
              defaultValue={member.responsibility ?? ""}
              maxLength={120}
              className="h-8"
              autoFocus
            />
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Save responsibility"
              disabled={save.pending}
            >
              {save.pending ? <Spinner /> : <Check />}
            </Button>
          </form>
        ) : (
          <span
            className={
              member.responsibility ? undefined : "text-muted-foreground"
            }
          >
            {member.responsibility ?? "Member"}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {archived ? null : (
          <span className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit responsibility of ${member.name}`}
              onClick={() => setEditing((v) => !v)}
            >
              <Pencil />
            </Button>
            <form action={remove.action}>
              <input type="hidden" name="committeeId" value={committeeId} />
              <input type="hidden" name="memberId" value={member.memberId} />
              <input type="hidden" name="operation" value="remove" />
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${member.name} from the committee`}
                disabled={remove.pending}
              >
                {remove.pending ? <Spinner /> : <UserMinus />}
              </Button>
            </form>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function AddMember({
  committeeId,
  existing,
}: {
  committeeId: string;
  existing: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; email: string; universityId: string }[]
  >([]);
  const [searching, startSearch] = useTransition();
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(
    null
  );
  const add = useRosterChange(() => {
    setChosen(null);
    setQuery("");
    setResults([]);
  });
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          startSearch(async () => setResults(await searchMembersAction(query)));
        }}
      >
        <div className="grid min-w-56 flex-1 gap-1.5">
          <Label htmlFor="roster-search">Add a member</Label>
          <Input
            id="roster-search"
            placeholder="Name, email or student ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={query.trim().length < 2 || searching}
        >
          {searching ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Search data-icon="inline-start" aria-hidden="true" />
          )}
          Search
        </Button>
      </form>
      {results.length > 0 ? (
        <ul
          className="flex flex-col divide-y rounded-md border"
          aria-label="Search results"
        >
          {results.map((result) => {
            const already = existing.has(result.id);
            return (
              <li
                key={result.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  {result.name}{" "}
                  <span className="text-muted-foreground">
                    · {result.email}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={chosen?.id === result.id ? "default" : "outline"}
                  disabled={already}
                  onClick={() => setChosen(result)}
                >
                  {already
                    ? "On committee"
                    : chosen?.id === result.id
                      ? "Selected"
                      : "Select"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {chosen ? (
        <form action={add.action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="committeeId" value={committeeId} />
          <input type="hidden" name="memberId" value={chosen.id} />
          <input type="hidden" name="operation" value="add" />
          <div className="grid min-w-56 flex-1 gap-1.5">
            <Label htmlFor="roster-responsibility">
              Responsibility for {chosen.name} (optional)
            </Label>
            <Input
              id="roster-responsibility"
              name="responsibility"
              maxLength={120}
              placeholder="For example: Logistics lead"
            />
          </div>
          <Button type="submit" disabled={add.pending}>
            {add.pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <UserPlus data-icon="inline-start" aria-hidden="true" />
            )}
            Add to committee
          </Button>
        </form>
      ) : null}
    </div>
  );
}
