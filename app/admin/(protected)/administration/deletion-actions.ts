"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import {
  completeAccountErasure,
  deleteEventPermanently,
  deleteMemberRecord,
  deleteProjectPermanently,
  eraseAccount,
  listAccountErasures,
  previewEventDeletion,
  previewMemberDeletion,
  previewProjectDeletion,
  type EventDeletionPreview,
  type MemberDeletionPreview,
  type PendingErasure,
  type ProjectDeletionPreview,
} from "@/lib/administration/server";
import { isUuid, requireSenior } from "@/lib/administration/access";
import {
  BLOCKER_MESSAGES,
  administrationMessage,
} from "@/lib/administration/messages";
import { confirmOwnPassword, deleteAuthUser } from "@/lib/auth/admin";
import { logServerError } from "@/lib/api/log";
import { processMembershipStorageDeletions } from "@/lib/membership/server";

export type DeletionKind = "event" | "project" | "membership" | "account";

export type DeletionPreview = {
  kind: DeletionKind;
  id: string;
  heading: string;
  confirmation: string;
  confirmationLabel: string;
  requiresPassword: boolean;
  removes: { label: string; detail: string }[];
  keeps: { label: string; detail: string }[];
  blockers: { code: string; message: string }[];
};

export type PreviewState =
  { ok: true; preview: DeletionPreview } | { ok: false; message: string };

export type DeletionState =
  | { ok: true; message: string; redirectTo: string; pending?: boolean }
  | { ok: false; message: string };

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function blockers(codes: string[]) {
  return codes.map((code) => ({
    code,
    message:
      BLOCKER_MESSAGES[code] ?? "Something still depends on this record.",
  }));
}

function eventPreview(p: EventDeletionPreview): DeletionPreview {
  return {
    kind: "event",
    id: p.id,
    heading: p.title,
    confirmation: p.confirmation,
    confirmationLabel: "Type the event title to confirm",
    requiresPassword: false,
    removes: [
      {
        label: "Event",
        detail: `${p.title} · ${p.committee}${p.archived ? " · archived" : ` · ${p.status}`}`,
      },
      {
        label: "Registrations",
        detail: `${plural(p.registrations, "registration")} with names, emails and phone numbers (${p.confirmed} confirmed, ${p.waitlisted} waitlisted, ${p.attended} attended)`,
      },
      ...(p.checkinSessions
        ? [
            {
              label: "Check-in",
              detail: "The attendance session and its codes",
            },
          ]
        : []),
      ...(p.coverImage
        ? [{ label: "Cover image", detail: "Deleted from private storage" }]
        : []),
    ],
    keeps: [
      {
        label: "Audit history",
        detail: `${plural(p.auditEntries, "entry", "entries")} stay, with the event's ID and title only`,
      },
      { label: "Members", detail: "No member account or profile changes" },
    ],
    blockers: blockers(p.blockers),
  };
}

function projectPreview(p: ProjectDeletionPreview): DeletionPreview {
  return {
    kind: "project",
    id: p.id,
    heading: p.title,
    confirmation: p.confirmation,
    confirmationLabel: "Type the project title to confirm",
    requiresPassword: false,
    removes: [
      {
        label: "Project",
        detail: `${p.title} · ${p.status.replace("_", " ")}`,
      },
      {
        label: "Review history",
        detail: `${plural(p.history, "revision entry", "revision entries")}, including reviewer feedback`,
      },
      ...(p.media
        ? [
            {
              label: "Images",
              detail: `${plural(p.media, "image")} deleted from private storage`,
            },
          ]
        : []),
    ],
    keeps: [
      {
        label: "Author",
        detail: `${p.author ?? "The author"} keeps their membership and other projects`,
      },
      {
        label: "Audit history",
        detail: "A record that the project was deleted, and by whom",
      },
    ],
    blockers: blockers(p.blockers),
  };
}

function memberPreview(p: MemberDeletionPreview): DeletionPreview {
  const account = p.mode === "account";
  return {
    kind: p.mode,
    id: p.userId,
    heading: p.name ?? p.signInEmail ?? "Account",
    confirmation: p.confirmation,
    confirmationLabel: account
      ? "Type the sign-in email to confirm"
      : "Type the membership email to confirm",
    requiresPassword: true,
    removes: [
      ...(p.hasMember
        ? [
            {
              label: "Membership record",
              detail: `${p.name} · ${p.membershipEmail}`,
            },
          ]
        : []),
      {
        label: "Applications",
        detail: `${plural(p.applications, "application")}${p.storedIdCards ? `, ${plural(p.storedIdCards, "stored ID card")} deleted from storage` : ""}`,
      },
      ...(p.photo
        ? [{ label: "Photo", detail: "Deleted from private storage" }]
        : []),
      ...(p.changeRequests
        ? [
            {
              label: "Correction requests",
              detail: plural(p.changeRequests, "request"),
            },
          ]
        : []),
      ...(p.committees
        ? [
            {
              label: "Committee places",
              detail: `Removed from ${plural(p.committees, "committee")}`,
            },
          ]
        : []),
      {
        label: "Registrations",
        detail: `${plural(p.registrations, "registration")} anonymized: name, email and phone removed; event counts and attendance stay`,
      },
      ...(account
        ? [
            {
              label: "Sign-in account",
              detail: `${p.signInEmail} is deleted from Supabase Auth`,
            },
            ...(p.formerAccess
              ? [
                  {
                    label: "Former dashboard grant",
                    detail: "The revoked grant row is removed",
                  },
                ]
              : []),
            {
              label: "Audit identity",
              detail: `${plural(p.auditAsActor, "entry", "entries")} by this account become "erased"; notes about it are removed`,
            },
          ]
        : []),
    ],
    keeps: account
      ? [
          {
            label: "Audit history",
            detail:
              "Every entry stays, without anything identifying this person",
          },
        ]
      : [
          {
            label: "Sign-in account",
            detail: `${p.signInEmail ?? "The account"} remains and may apply again`,
          },
          { label: "Audit history", detail: "Kept as recorded" },
        ],
    blockers: blockers(p.blockers),
  };
}

/** Server actions receive whatever the browser sends: accept only the known kinds. */
const KINDS: readonly string[] = ["event", "project", "membership", "account"];

export async function previewDeletionAction(
  kind: DeletionKind,
  id: string
): Promise<PreviewState> {
  if (!KINDS.includes(kind))
    return { ok: false, message: administrationMessage("VALIDATION_ERROR") };
  const actor = await requireSenior();
  if (!actor || (kind === "account" && actor.accessLevel !== "TECHNICAL"))
    return { ok: false, message: administrationMessage("FORBIDDEN") };
  if (!isUuid(id))
    return { ok: false, message: administrationMessage("NOT_FOUND") };
  try {
    const result =
      kind === "event"
        ? await previewEventDeletion(actor.userId, id)
        : kind === "project"
          ? await previewProjectDeletion(actor.userId, id)
          : await previewMemberDeletion(actor.userId, id, kind);
    if (result.code !== "SUCCESS")
      return { ok: false, message: administrationMessage(result.code) };
    const preview = result.preview as never;
    return {
      ok: true,
      preview:
        kind === "event"
          ? eventPreview(preview)
          : kind === "project"
            ? projectPreview(preview)
            : memberPreview(preview),
    };
  } catch (error) {
    logServerError("administration_preview_failed", error);
    return { ok: false, message: administrationMessage("UNAVAILABLE") };
  }
}

const DESTINATIONS: Record<DeletionKind, string> = {
  event: "/admin/events",
  project: "/admin/projects",
  membership: "/admin/administration/members",
  account: "/admin/administration/members",
};

/**
 * Deletes for good, after the same checks the preview showed. Member and account deletion also
 * re-check the administrator's own password. Files are removed by the deletion queue right after.
 */
export async function deletePermanentlyAction(
  kind: DeletionKind,
  id: string,
  confirmation: string,
  password: string
): Promise<DeletionState> {
  // Checked before anything else: an unknown kind must never reach a deletion branch.
  if (
    !KINDS.includes(kind) ||
    !isUuid(id) ||
    typeof confirmation !== "string" ||
    confirmation.length > 300 ||
    typeof password !== "string"
  )
    return { ok: false, message: administrationMessage("VALIDATION_ERROR") };
  const actor = await requireSenior();
  if (!actor || (kind === "account" && actor.accessLevel !== "TECHNICAL"))
    return { ok: false, message: administrationMessage("FORBIDDEN") };
  const people = kind === "membership" || kind === "account";
  if (people) {
    const check = await confirmOwnPassword(actor.email ?? "", password);
    if (check !== "VALID")
      return {
        ok: false,
        message: administrationMessage(
          check === "INVALID" ? "PASSWORD_INVALID" : "PASSWORD_UNAVAILABLE"
        ),
      };
  }
  try {
    const result =
      kind === "event"
        ? await deleteEventPermanently(actor.userId, id, confirmation)
        : kind === "project"
          ? await deleteProjectPermanently(actor.userId, id, confirmation)
          : kind === "membership"
            ? await deleteMemberRecord(actor.userId, id, confirmation)
            : await eraseAccount(actor.userId, id, confirmation);
    if (result.code === "BLOCKED") {
      const list = (result.blockers as string[] | undefined) ?? [];
      return {
        ok: false,
        message: list.map((code) => BLOCKER_MESSAGES[code] ?? code).join(" "),
      };
    }
    if (result.code !== "SUCCESS")
      return { ok: false, message: administrationMessage(result.code) };
    after(() => processMembershipStorageDeletions(25));
    revalidatePath("/admin", "layout");
    if (kind !== "account")
      return {
        ok: true,
        message:
          kind === "event"
            ? "The event and its registrations were deleted permanently."
            : kind === "project"
              ? "The project was deleted permanently."
              : "The membership record was deleted. The sign-in account remains.",
        redirectTo: DESTINATIONS[kind],
      };
    const finished = await finishErasure(
      actor.userId,
      String(result.erasureId),
      id
    );
    return finished
      ? {
          ok: true,
          message:
            "The account and its membership data were deleted permanently.",
          redirectTo: DESTINATIONS.account,
        }
      : {
          ok: true,
          pending: true,
          message:
            "Membership data and audit identity are removed, but Supabase Auth did not confirm deleting the sign-in account. It is listed under pending erasures in Administration; retry there.",
          redirectTo: "/admin/administration",
        };
  } catch (error) {
    logServerError("administration_delete_failed", error);
    return {
      ok: false,
      message:
        "The result could not be confirmed. Refresh before trying again; nothing is deleted twice.",
    };
  }
}

/** Deletes the Auth identity, then lets the database confirm it is gone. */
async function finishErasure(
  actorId: string,
  erasureId: string,
  userId: string
) {
  const deleted = await deleteAuthUser(userId);
  if (deleted.code !== "SUCCESS") return false;
  const completed = await completeAccountErasure(actorId, erasureId);
  return completed.code === "SUCCESS";
}

/** Retries an erasure whose Auth deletion was not confirmed. Technical Team only. */
export async function retryErasureAction(
  erasureId: string
): Promise<DeletionState> {
  const actor = await requireSenior();
  if (!actor || actor.accessLevel !== "TECHNICAL" || !isUuid(erasureId))
    return { ok: false, message: administrationMessage("FORBIDDEN") };
  try {
    const listed = await listAccountErasures(actor.userId);
    const erasure = (
      (listed.erasures as PendingErasure[] | undefined) ?? []
    ).find((item) => item.id === erasureId);
    if (!erasure)
      return { ok: false, message: administrationMessage("NOT_FOUND") };
    const done = await finishErasure(actor.userId, erasure.id, erasure.userId);
    revalidatePath("/admin/administration");
    return done
      ? {
          ok: true,
          message: "The sign-in account is deleted. The erasure is complete.",
          redirectTo: "/admin/administration",
        }
      : {
          ok: false,
          message:
            "Supabase Auth still did not confirm the deletion. Try again later.",
        };
  } catch (error) {
    logServerError("administration_erasure_retry_failed", error);
    return { ok: false, message: administrationMessage("UNAVAILABLE") };
  }
}
