"use client";

import {
  useActionState,
  useId,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRightLeft,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Crown,
  Undo2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/admin/empty-state";
import { ReviewActionDialog } from "@/components/admin/review-action-dialog";
import { TeamStatusBadge } from "@/components/admin/verification-badges";
import { Badge } from "@/components/ui/badge";
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
import type {
  LeaderRecord,
  PositionRecord,
  TeamRecord,
} from "@/lib/verification/types";
import { revokeAppointmentAction } from "@/app/admin/(protected)/membership/verification-actions";
import { searchMembersAction, type AdminActionState } from "../../actions";
import {
  assignLeaderAction,
  changeLeaderPositionAction,
  deleteTeamAction,
  moveTeamAction,
  saveTeamAction,
  teamStatusAction,
} from "./team-actions";

const initial: AdminActionState = { status: "idle" };
const selectClass = "h-9 rounded-md border bg-background px-3 text-sm";

type Committee = { id: string; name: string };

/** Runs a team action, reports the outcome, and refreshes the page on success. */
function useTeamAction(
  action: (
    previous: AdminActionState,
    form: FormData
  ) => Promise<AdminActionState>,
  onDone?: () => void
) {
  const router = useRouter();
  return useActionState(async (previous: AdminActionState, form: FormData) => {
    const result = await action(previous, form);
    if (result.status === "success") {
      toast.success(result.message);
      onDone?.();
      router.refresh();
    }
    return result;
  }, initial);
}

function ErrorLine({ state }: { state: AdminActionState }) {
  return state.status === "error" ? (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  ) : null;
}

/**
 * The committee's teams, their leaders and the members' requests (ADR 0025):
 * Engineering Society → committee → team → appointment. Each control follows a
 * permission for this committee (ADR 0027): teams.manage (canManage),
 * leadership.assign (canAppoint) and leadership.review (canDecide, to change or
 * revoke). An appointment grants the dashboard permissions configured for its
 * team, if any. The routines check every permission again.
 */
export function CommitteeTeams({
  committeeId,
  archived,
  teams,
  positions,
  committees,
  canAppoint,
  canDecide,
  canManage,
}: {
  committeeId: string;
  archived: boolean;
  teams: TeamRecord[];
  positions: PositionRecord[];
  committees: Committee[];
  canAppoint: boolean;
  canDecide: boolean;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {archived ? (
        <p className="text-sm text-muted-foreground">
          Archived committees keep their teams and history but take no new teams
          or appointments.
        </p>
      ) : canManage ? (
        <div>
          <TeamFormDialog committeeId={committeeId} />
        </div>
      ) : null}
      {canAppoint || canDecide ? null : (
        <p className="text-sm text-muted-foreground">
          Leaders are appointed, changed and revoked by people with the
          leadership permissions for this committee.
        </p>
      )}
      {teams.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No teams"
          description="Teams are optional: the committee's own Chief and Assistant Chief are above. Create a team when part of the committee needs its own leaders."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {teams.map((team) => (
            <TeamItem
              key={team.id}
              committeeId={committeeId}
              committeeArchived={archived}
              team={team}
              positions={positions}
              committees={committees.filter((c) => c.id !== committeeId)}
              canAppoint={canAppoint}
              canDecide={canDecide}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The committee's own leaders (ADR 0026): Chief and Assistant Chief of the
 * committee itself, with no team, managed separately from team leaders. Every
 * committee can have them, whether or not it has teams. Leadership reviewers
 * (here, Board Administration) appoint, change and revoke; the routines check
 * again and enforce one holder of each position at committee level.
 */
export function CommitteeLeaders({
  committeeId,
  committeeName,
  archived,
  leaders,
  pendingRequests,
  positions,
  canAppoint,
  canDecide,
}: {
  committeeId: string;
  committeeName: string;
  archived: boolean;
  leaders: LeaderRecord[];
  pendingRequests: number;
  positions: PositionRecord[];
  canAppoint: boolean;
  canDecide: boolean;
}) {
  const editable = canAppoint && !archived;
  const decidable = canDecide && !archived;
  return (
    <div className="flex flex-col gap-3">
      {leaders.length === 0 ? (
        <EmptyState
          icon={Crown}
          title="No committee leaders"
          description={
            editable
              ? "Appoint a Chief or Assistant Chief of the committee, or approve a member's request in Membership → Leadership."
              : "Committee-level Chief and Assistant Chief appear here once appointed."
          }
        />
      ) : (
        <ul
          className="flex flex-col divide-y rounded-md border"
          aria-label={`Leaders of ${committeeName}`}
        >
          {leaders.map((leader) => (
            <LeaderRow
              key={leader.id}
              committeeId={committeeId}
              leader={leader}
              positions={positions}
              canChange={decidable}
              canRevoke={decidable}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {editable ? (
          <AssignLeaderDialog
            committeeId={committeeId}
            teamId={null}
            scopeName={committeeName}
            leaderIds={leaders.map((l) => l.memberId)}
            positions={positions}
            label="Appoint a committee leader"
          />
        ) : null}
        {pendingRequests > 0 ? (
          <Link
            href={`/admin/membership/leadership?committee=${committeeId}`}
            className="text-sm underline-offset-4 hover:underline"
          >
            {pendingRequests} pending request{pendingRequests === 1 ? "" : "s"}{" "}
            in Membership → Leadership
          </Link>
        ) : null}
      </div>
      {canAppoint || canDecide ? null : (
        <p className="text-sm text-muted-foreground">
          Committee leaders are appointed, changed and revoked by people with
          the leadership permissions for this committee.
        </p>
      )}
    </div>
  );
}

function TeamItem({
  committeeId,
  committeeArchived,
  team,
  positions,
  committees,
  canAppoint,
  canDecide,
  canManage,
}: {
  committeeId: string;
  committeeArchived: boolean;
  team: TeamRecord;
  positions: PositionRecord[];
  committees: Committee[];
  canAppoint: boolean;
  canDecide: boolean;
  canManage: boolean;
}) {
  const editable = !committeeArchived && team.status !== "archived";
  // An inactive team keeps its leaders until they are revoked (archiving needs
  // that first); only an active team takes new appointments or position changes.
  const canRevoke = canDecide && editable;
  const canChange = canRevoke && team.status === "active";
  const canAssign = canAppoint && editable && team.status === "active";
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="break-words">{team.name.en}</span>
            {team.name.ar ? (
              <span dir="rtl" lang="ar" className="text-muted-foreground">
                {team.name.ar}
              </span>
            ) : null}
            <TeamStatusBadge status={team.status} />
            {team.pendingRequests > 0 ? (
              <Badge variant="outline" className="border-dashed">
                {team.pendingRequests} pending request
                {team.pendingRequests === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </p>
          {team.description.en ? (
            <p className="text-sm text-muted-foreground">
              {team.description.en}
            </p>
          ) : null}
          {team.description.ar ? (
            <p dir="rtl" lang="ar" className="text-sm text-muted-foreground">
              {team.description.ar}
            </p>
          ) : null}
        </div>
        {committeeArchived || !canManage ? null : (
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <TeamFormDialog committeeId={committeeId} team={team} />
            ) : null}
            {editable && committees.length > 0 ? (
              <MoveTeamDialog
                committeeId={committeeId}
                team={team}
                committees={committees}
              />
            ) : null}
            <TeamStatusControls committeeId={committeeId} team={team} />
            {!team.inUse ? (
              <DeleteTeam committeeId={committeeId} team={team} />
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Leaders</h4>
        {team.leaders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leaders appointed.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {team.leaders.map((leader) => (
              <LeaderRow
                key={leader.id}
                committeeId={committeeId}
                leader={leader}
                positions={positions}
                canChange={canChange}
                canRevoke={canRevoke}
              />
            ))}
          </ul>
        )}
        {canAssign ? (
          <AssignLeaderDialog
            committeeId={committeeId}
            teamId={team.id}
            scopeName={team.name.en}
            leaderIds={team.leaders.map((l) => l.memberId)}
            positions={positions}
          />
        ) : canAppoint && team.status === "inactive" ? (
          <p className="text-xs text-muted-foreground">
            Activate the team to appoint leaders.
          </p>
        ) : null}
      </div>
    </li>
  );
}

function TeamFormDialog({
  committeeId,
  team,
}: {
  committeeId: string;
  team?: TeamRecord;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useTeamAction(saveTeamAction, () =>
    setOpen(false)
  );
  const field = state.status === "error" ? state.field : undefined;
  return (
    <>
      <Button
        variant={team ? "outline" : "default"}
        size={team ? "sm" : "default"}
        onClick={() => setOpen(true)}
      >
        {team ? (
          <Pencil data-icon="inline-start" aria-hidden="true" />
        ) : (
          <Plus data-icon="inline-start" aria-hidden="true" />
        )}
        {team ? "Edit" : "New team"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{team ? "Edit team" : "New team"}</DialogTitle>
            <DialogDescription>
              Names appear on members&apos; profiles in English and Arabic. The
              Arabic name falls back to the English one when empty.
            </DialogDescription>
          </DialogHeader>
          <form action={run} className="grid gap-4" aria-busy={pending}>
            <input type="hidden" name="committeeId" value={committeeId} />
            {team ? (
              <input type="hidden" name="teamId" value={team.id} />
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id={`${id}-en`}
                name="nameEn"
                label="Name (English)"
                defaultValue={team?.name.en}
                required
                invalid={field === "nameEn"}
              />
              <TextField
                id={`${id}-ar`}
                name="nameAr"
                label="Name (Arabic)"
                defaultValue={team?.name.ar ?? ""}
                arabic
                invalid={field === "nameAr"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-den`}>Description (English)</Label>
              <Textarea
                id={`${id}-den`}
                name="descriptionEn"
                defaultValue={team?.description.en ?? ""}
                maxLength={1000}
                rows={3}
                aria-invalid={field === "descriptionEn"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-dar`}>Description (Arabic)</Label>
              <Textarea
                id={`${id}-dar`}
                name="descriptionAr"
                dir="rtl"
                lang="ar"
                defaultValue={team?.description.ar ?? ""}
                maxLength={1000}
                rows={3}
                aria-invalid={field === "descriptionAr"}
              />
            </div>
            <ErrorLine state={state} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {team ? "Save team" : "Create team"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TextField({
  id,
  name,
  label,
  defaultValue,
  required,
  arabic,
  invalid,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  arabic?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        defaultValue={defaultValue}
        maxLength={80}
        required={required}
        dir={arabic ? "rtl" : undefined}
        lang={arabic ? "ar" : undefined}
        aria-invalid={invalid}
      />
    </div>
  );
}

function MoveTeamDialog({
  committeeId,
  team,
  committees,
}: {
  committeeId: string;
  team: TeamRecord;
  committees: Committee[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useTeamAction(moveTeamAction, () =>
    setOpen(false)
  );
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ArrowRightLeft data-icon="inline-start" aria-hidden="true" />
        Move
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {team.name.en}</DialogTitle>
            <DialogDescription>
              The team&apos;s leaders keep their positions under the new
              committee. Pending requests are closed, and members can request
              again. No dashboard access changes.
            </DialogDescription>
          </DialogHeader>
          <form action={run} className="grid gap-4" aria-busy={pending}>
            <input type="hidden" name="committeeId" value={committeeId} />
            <input type="hidden" name="teamId" value={team.id} />
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-target`}>New committee</Label>
              <select
                id={`${id}-target`}
                name="targetCommitteeId"
                required
                defaultValue=""
                className={selectClass}
              >
                <option value="" disabled>
                  Choose a committee
                </option>
                {committees.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <ErrorLine state={state} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Move team
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConfirmButton({
  label,
  icon,
  title,
  description,
  action,
  hidden,
  destructive,
}: {
  label: string;
  icon: ReactNode;
  title: string;
  description: string;
  action: (
    previous: AdminActionState,
    form: FormData
  ) => Promise<AdminActionState>;
  hidden: Record<string, string>;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useTeamAction(action, () => setOpen(false));
  return (
    <>
      <Button
        variant={destructive ? "destructive" : "outline"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {icon}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <form action={run} className="grid gap-4" aria-busy={pending}>
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <ErrorLine state={state} />
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
                variant={destructive ? "destructive" : "default"}
                disabled={pending}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {label}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TeamStatusControls({
  committeeId,
  team,
}: {
  committeeId: string;
  team: TeamRecord;
}) {
  const hidden = (status: string) => ({
    committeeId,
    teamId: team.id,
    status,
  });
  return (
    <>
      {team.status === "active" ? (
        <ConfirmButton
          label="Deactivate"
          icon={<Pause data-icon="inline-start" aria-hidden="true" />}
          title={`Deactivate ${team.name.en}?`}
          description="Members can no longer request its positions, and pending requests are closed. Its leaders keep their positions until you revoke them."
          action={teamStatusAction}
          hidden={hidden("inactive")}
        />
      ) : (
        <ConfirmButton
          label={team.status === "archived" ? "Restore" : "Activate"}
          icon={<Play data-icon="inline-start" aria-hidden="true" />}
          title={`${team.status === "archived" ? "Restore" : "Activate"} ${team.name.en}?`}
          description="Members can request its positions again."
          action={teamStatusAction}
          hidden={hidden("active")}
        />
      )}
      {team.status !== "archived" ? (
        <ConfirmButton
          label="Archive"
          icon={<Archive data-icon="inline-start" aria-hidden="true" />}
          title={`Archive ${team.name.en}?`}
          description="Archiving keeps the team's requests and appointments as history. Revoke its active appointments first."
          action={teamStatusAction}
          hidden={hidden("archived")}
          destructive
        />
      ) : null}
    </>
  );
}

function DeleteTeam({
  committeeId,
  team,
}: {
  committeeId: string;
  team: TeamRecord;
}) {
  return (
    <ConfirmButton
      label="Delete"
      icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
      title={`Delete ${team.name.en}?`}
      description="This team has no requests or appointments, so it can be removed completely. Teams with history are archived instead."
      action={deleteTeamAction}
      hidden={{ committeeId, teamId: team.id }}
      destructive
    />
  );
}

function LeaderRow({
  committeeId,
  leader,
  positions,
  canChange,
  canRevoke,
}: {
  committeeId: string;
  leader: LeaderRecord;
  positions: PositionRecord[];
  canChange: boolean;
  canRevoke: boolean;
}) {
  const id = useId();
  const [state, run, pending] = useTeamAction(changeLeaderPositionAction);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block truncate font-medium">{leader.name}</span>
        <span
          className="block truncate text-xs text-muted-foreground"
          dir="ltr"
        >
          {leader.email}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {canChange ? (
          <form action={run} className="flex items-center gap-2">
            <input type="hidden" name="committeeId" value={committeeId} />
            <input type="hidden" name="appointmentId" value={leader.id} />
            <input type="hidden" name="revision" value={leader.revision} />
            <Label htmlFor={`${id}-position`} className="sr-only">
              Position of {leader.name}
            </Label>
            <select
              id={`${id}-position`}
              name="position"
              defaultValue={leader.position.id}
              className={selectClass}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              disabled={pending}
            >
              {positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label.en}
                </option>
              ))}
            </select>
            {pending ? <Spinner /> : null}
          </form>
        ) : (
          <Badge variant="secondary">{leader.position.label.en}</Badge>
        )}
        {canRevoke ? (
          <ReviewActionDialog
            action={revokeAppointmentAction}
            hidden={{
              appointmentId: leader.id,
              revision: String(leader.revision),
              returnPath: `/admin/administration/committees/${committeeId}`,
            }}
            icon={<Undo2 aria-hidden="true" data-icon="inline-start" />}
            label="Revoke"
            title={`Revoke ${leader.name}'s appointment?`}
            description="The position is freed and the member sees the reason on their profile. The appointment stays in the history."
            reason={{ label: "Reason for the member", required: true }}
            successText="Appointment revoked"
            variant="outline"
          />
        ) : null}
      </span>
      {state.status === "error" ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

/** A direct appointment in a team, or at committee level when `teamId` is null (ADR 0026). */
function AssignLeaderDialog({
  committeeId,
  teamId,
  scopeName,
  leaderIds,
  positions,
  label = "Appoint a leader",
}: {
  committeeId: string;
  teamId: string | null;
  scopeName: string;
  leaderIds: string[];
  positions: PositionRecord[];
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; email: string }[]
  >([]);
  const [searching, startSearch] = useTransition();
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(
    null
  );
  const [state, run, pending] = useTeamAction(assignLeaderAction, () => {
    setOpen(false);
    setChosen(null);
    setResults([]);
    setQuery("");
  });
  const leaders = new Set(leaderIds);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <UserPlus data-icon="inline-start" aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Appoint a leader of {scopeName}</DialogTitle>
            <DialogDescription>
              A direct appointment, without a request. Position limits apply.
              The leader receives the dashboard permissions configured for this
              committee or team, if any.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              startSearch(async () =>
                setResults(await searchMembersAction(query))
              );
            }}
          >
            <div className="grid min-w-48 flex-1 gap-1.5">
              <Label htmlFor={`${id}-search`}>Member</Label>
              <Input
                id={`${id}-search`}
                placeholder="Name or email"
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
              className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-md border"
              aria-label="Search results"
            >
              {results.map((result) => (
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
                    type="button"
                    variant={chosen?.id === result.id ? "default" : "outline"}
                    disabled={leaders.has(result.id)}
                    onClick={() => setChosen(result)}
                  >
                    {leaders.has(result.id)
                      ? "Already a leader"
                      : chosen?.id === result.id
                        ? "Selected"
                        : "Select"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <form action={run} className="grid gap-4" aria-busy={pending}>
            <input type="hidden" name="committeeId" value={committeeId} />
            {teamId ? (
              <input type="hidden" name="teamId" value={teamId} />
            ) : null}
            <input type="hidden" name="memberId" value={chosen?.id ?? ""} />
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-position`}>Position</Label>
              <select
                id={`${id}-position`}
                name="position"
                defaultValue={positions[0]?.id}
                className={selectClass}
              >
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label.en}
                    {p.maxHolders !== null ? ` (up to ${p.maxHolders})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-note`}>Internal note (optional)</Label>
              <Textarea
                id={`${id}-note`}
                name="note"
                maxLength={1000}
                rows={2}
              />
            </div>
            <ErrorLine state={state} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !chosen}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {chosen ? `Appoint ${chosen.name}` : "Choose a member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
