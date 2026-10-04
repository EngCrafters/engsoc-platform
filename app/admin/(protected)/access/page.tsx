import { getManagerContext } from "@/lib/auth/manager";
import {
  listAccess,
  listAccessAudit,
  listAvailableUsers,
} from "@/lib/access/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AccessManagement } from "./access-management";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function auditState(
  value: unknown,
  committees: ReadonlyArray<{ id: string; name: string }>
) {
  if (!value || typeof value !== "object") return "None";
  const state = value as {
    accessLevel?: string;
    committeeId?: string | null;
    active?: boolean;
  };
  const level =
    state.accessLevel === "TECHNICAL"
      ? "Technical Team"
      : state.accessLevel === "BOARD_ADMIN"
        ? "Board Administration"
        : "Committee Manager";
  const committee = state.committeeId
    ? (committees.find((item) => item.id === state.committeeId)?.name ??
      state.committeeId)
    : "All Committees";
  return `${level} · ${committee} · ${state.active ? "Active" : "Revoked"}`;
}

export default async function AccessPage() {
  const actor = await getManagerContext();
  if (actor.kind !== "manager" || actor.accessLevel !== "TECHNICAL") {
    return (
      <p role="alert">This action is available only to the Technical Team.</p>
    );
  }
  const [rows, users, audit] = await Promise.all([
    listAccess(actor.userId),
    listAvailableUsers(actor.userId),
    listAccessAudit(actor.userId),
  ]);
  return (
    <section aria-labelledby="access-title" className="space-y-6">
      <AdminPageHeader
        headingId="access-title"
        title="Technical Administration"
        description="Manage committee managers and Board Administration access."
      />
      <AccessManagement
        rows={[...rows]}
        users={[...users]}
        committees={[...actor.committees]}
      />
      <section className="space-y-3" aria-labelledby="access-audit-title">
        <h2 id="access-audit-title" className="text-lg font-semibold">
          Recent access changes
        </h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Previous</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    {new Date(entry.occurred_at).toLocaleString("en-GB", {
                      timeZone: "Asia/Muscat",
                    })}
                  </TableCell>
                  <TableCell>
                    {entry.action.replace("access.", "").replaceAll("_", " ")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {users.find((user) => user.user_id === entry.actor_user_id)
                      ?.email ??
                      entry.actor_user_id ??
                      "Migration"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {users.find((user) => user.user_id === entry.target_user_id)
                      ?.email ?? entry.target_user_id}
                  </TableCell>
                  <TableCell>
                    {auditState(entry.previous_state, actor.committees)}
                  </TableCell>
                  <TableCell>
                    {auditState(entry.new_state, actor.committees)}
                  </TableCell>
                  <TableCell>{entry.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </section>
  );
}
