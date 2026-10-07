import { getManagerContext } from "@/lib/auth/manager";
import {
  listAccess,
  listAccessAudit,
  listAuthDirectory,
} from "@/lib/access/server";
import { AdminPageHeader } from "@/components/admin/page-header";
import { UserDirectory } from "./user-directory";
import { auditStateLabel, type UserRecord } from "./user-types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const auditLabels: Record<string, string> = {
  "manager.assigned": "Manager assigned",
  "manager.reassigned": "Manager reassigned",
  "manager.revoked": "Manager revoked",
  "board_admin.granted": "Board access granted",
  "board_admin.revoked": "Board access revoked",
  "technical.granted": "Technical access granted",
  "technical.revoked": "Technical access revoked",
  "access.revoked": "Legacy access revoked",
};

export default async function AccessPage() {
  const actor = await getManagerContext();
  if (actor.kind !== "manager" || actor.accessLevel !== "TECHNICAL") {
    return (
      <p role="alert">This action is available only to the Technical Team.</p>
    );
  }
  const [rows, directory, audit] = await Promise.all([
    listAccess(actor.userId),
    listAuthDirectory(actor.userId),
    listAccessAudit(actor.userId),
  ]);
  // Join sign-in identities with their (separate) application access.
  const accessByUser = new Map(rows.map((row) => [row.user_id, row]));
  const users: UserRecord[] = directory.map((entry) => {
    const grant = accessByUser.get(entry.user_id);
    return {
      userId: entry.user_id,
      email: entry.email,
      emailConfirmed: entry.email_confirmed,
      invited: entry.invited,
      createdAt: new Date(entry.created_at).toISOString(),
      lastSignInAt: entry.last_sign_in_at
        ? new Date(entry.last_sign_in_at).toISOString()
        : null,
      access: grant
        ? {
            level: grant.access_level,
            committeeId: grant.committee_id,
            committeeName: grant.committee_name,
            active: grant.active,
          }
        : null,
    };
  });
  const emailOf = (id: string | null) =>
    directory.find((entry) => entry.user_id === id)?.email;
  return (
    <section aria-labelledby="access-title" className="space-y-6">
      <AdminPageHeader
        headingId="access-title"
        title="Technical Administration"
        description="Manage committee, Board Administration, and Technical Team access."
      />
      <Tabs defaultValue="users" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="activity">Access activity</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UserDirectory
            users={users}
            committees={[...actor.committees]}
            currentUserId={actor.userId}
            adminConfigured={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
          />
        </TabsContent>
        <TabsContent value="activity">
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
                      {auditLabels[entry.action] ?? entry.action}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {emailOf(entry.actor_user_id) ??
                        entry.actor_user_id ??
                        "Migration"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {emailOf(entry.target_user_id) ?? entry.target_user_id}
                    </TableCell>
                    <TableCell>
                      {auditStateLabel(entry.previous_state, actor.committees)}
                    </TableCell>
                    <TableCell>
                      {auditStateLabel(entry.new_state, actor.committees)}
                    </TableCell>
                    <TableCell>{entry.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
