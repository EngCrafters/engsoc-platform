"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Save, Search, Send, TestTube2, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import type { RenderedMessage } from "@/lib/email/format";
import type { Audience, Campaign, Recipient } from "@/lib/email/server";
import type { TemplateRow } from "../template-list";
import {
  memberNamesAction,
  previewAudienceAction,
  queueCampaignAction,
  renderPreviewAction,
  saveDraftAction,
  saveTemplateAction,
  searchMembersAction,
  sendTestAction,
} from "../actions";

export type FilterOptions = {
  categories: {
    id: string;
    label: { en: string; ar: string };
    academicYear: boolean;
  }[];
  institutions: { id: string; name: { en: string; ar: string } }[];
  disciplines: string[];
  interests: string[];
  committees: {
    id: string;
    name: string;
    teams: { id: string; name: string }[];
  }[];
  positions: { id: string; label: { en: string; ar: string } }[];
  unsubscribed: number;
  suppressed: number;
};

type Content = {
  language: "en" | "ar" | "both";
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
};

const DISCIPLINES: Record<string, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  civil: "Civil",
  petroleum: "Petroleum",
  chemical: "Chemical",
  mechatronics: "Mechatronics",
  industrial: "Industrial",
};
const INTERESTS: Record<string, string> = {
  cad: "CAD",
  simulation: "Simulation",
  embedded: "Embedded systems",
  robotics: "Robotics",
  structures: "Structures",
  process: "Process engineering",
  data: "Data",
  programming: "Programming",
  power: "Power",
  reservoir: "Reservoir",
  quality: "Quality",
  management: "Management",
  sustainability: "Sustainability",
  hse: "Health, safety and environment",
};
const PAGE = 25;

/** A labelled group of toggle chips: several values in one filter match any of them. */
function Chips<T extends string | number>({
  label,
  hint,
  options,
  selected,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{label}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <Button
              key={String(option.value)}
              type="button"
              size="sm"
              variant={on ? "default" : "outline"}
              aria-pressed={on}
              onClick={() =>
                onChange(
                  on
                    ? selected.filter((v) => v !== option.value)
                    : [...selected, option.value]
                )
              }
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Pick members by name or email, to include or exclude them individually. */
function MemberPicker({
  label,
  ids,
  names,
  onChange,
  onName,
}: {
  label: string;
  ids: string[];
  names: Map<string, { name: string; email: string }>;
  onChange: (ids: string[]) => void;
  onName: (member: { id: string; name: string; email: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{
    query: string;
    members: { id: string; name: string; email: string }[];
  }>({ query: "", members: [] });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      setFound({ query: q, members: await searchMembersAction(q) });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const results =
    query.trim().length >= 2 && found.query === query.trim()
      ? found.members
      : [];
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search members by name or email"
        aria-label={`${label}: search members`}
      />
      {results.length ? (
        <ul
          className="flex flex-col divide-y rounded-md border"
          aria-label="Matching members"
        >
          {results
            .filter((m) => !ids.includes(m.id))
            .map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onName(m);
                    onChange([...ids, m.id]);
                    setQuery("");
                  }}
                >
                  {m.name}{" "}
                  <span className="text-muted-foreground">· {m.email}</span>
                </button>
              </li>
            ))}
        </ul>
      ) : null}
      {ids.length ? (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {names.get(id)?.name ?? "Member"}
              <button
                type="button"
                aria-label={`Remove ${names.get(id)?.name ?? "member"}`}
                onClick={() => onChange(ids.filter((x) => x !== id))}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The draft editor (ADR 0028). The audience is computed on the server: the browser only ever holds
 * one page of recipients. Sending is two steps: the sender reviews the exact count, and the
 * database recounts when queuing.
 */
export function Composer({
  campaign,
  options,
  templates,
  initialNames,
  sending,
  actorEmail,
}: {
  campaign: Campaign;
  options: FilterOptions;
  templates: TemplateRow[];
  initialNames: { id: string; name: string; email: string }[];
  sending: { enabled: boolean; reason: string | null };
  actorEmail: string | null;
}) {
  const router = useRouter();
  const [revision, setRevision] = useState(campaign.revision);
  const [content, setContent] = useState<Content>({
    language: campaign.language,
    subjectEn: campaign.subjectEn ?? "",
    subjectAr: campaign.subjectAr ?? "",
    bodyEn: campaign.bodyEn ?? "",
    bodyAr: campaign.bodyAr ?? "",
  });
  const [audience, setAudience] = useState<Audience>(campaign.audience ?? {});
  const [dirty, setDirty] = useState(false);
  const [names, setNames] = useState(
    () =>
      new Map(initialNames.map((m) => [m.id, { name: m.name, email: m.email }]))
  );
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<{
    count: number;
    matching: number;
    recipients: Recipient[];
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Which query the shown preview answers; it is loading while that differs from the current one.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedMessage | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [busy, start] = useTransition();
  const request = useRef(0);

  const set = <K extends keyof Content>(key: K, value: Content[K]) => {
    setContent((c) => ({ ...c, [key]: value }));
    setDirty(true);
    setRendered(null);
  };
  const setFilter = <K extends keyof Audience>(key: K, value: Audience[K]) => {
    setAudience((a) => {
      const next = { ...a, [key]: value };
      if (Array.isArray(value) && value.length === 0) delete next[key];
      // Teams belong to the chosen committees.
      if (key === "committees") {
        const allowed = new Set(
          options.committees
            .filter((c) => (value as string[]).includes(c.id))
            .flatMap((c) => c.teams.map((t) => t.id))
        );
        const teams = (next.teams ?? []).filter((t) => allowed.has(t));
        if (teams.length) next.teams = teams;
        else delete next.teams;
      }
      return next;
    });
    setDirty(true);
    setOffset(0);
  };

  // The server computes the audience; one request at a time, debounced.
  const previewKey = JSON.stringify([audience, search, offset]);
  const loading = loadedKey !== previewKey;
  useEffect(() => {
    const ticket = ++request.current;
    const timer = setTimeout(async () => {
      const result = await previewAudienceAction(audience, search, offset);
      if (ticket !== request.current) return;
      setLoadedKey(JSON.stringify([audience, search, offset]));
      if (result.code === "SUCCESS") {
        setPreview({
          count: result.count ?? 0,
          matching: result.matching ?? 0,
          recipients: result.recipients ?? [],
        });
        setPreviewError(null);
      } else setPreviewError(result.message);
    }, 350);
    return () => clearTimeout(timer);
  }, [audience, search, offset]);

  const payload = { ...content, audience };
  const needsEn = content.language !== "ar";
  const needsAr = content.language !== "en";
  const complete =
    (!needsEn || (content.subjectEn.trim() && content.bodyEn.trim())) &&
    (!needsAr || (content.subjectAr.trim() && content.bodyAr.trim()));

  const summary = useMemo(() => {
    const parts: string[] = [];
    const label = (list: string[] | undefined, map: (v: string) => string) =>
      list?.length ? list.map(map).join(" or ") : null;
    const categories = label(
      audience.categories,
      (v) => options.categories.find((c) => c.id === v)?.label.en ?? v
    );
    if (categories) parts.push(categories);
    const institutions = label(
      audience.institutions,
      (v) => options.institutions.find((i) => i.id === v)?.name.en ?? v
    );
    if (institutions) parts.push(`at ${institutions} (self-reported)`);
    if (audience.years?.length)
      parts.push(`academic year ${audience.years.join(", ")}`);
    const disciplines = label(audience.disciplines, (v) => DISCIPLINES[v] ?? v);
    if (disciplines) parts.push(disciplines);
    const interests = label(audience.interests, (v) => INTERESTS[v] ?? v);
    if (interests) parts.push(`interested in ${interests}`);
    if (audience.squ?.length)
      parts.push(
        `SQU verification: ${audience.squ.join(" or ").replace("_", " ")}`
      );
    const committees = label(
      audience.committees,
      (v) => options.committees.find((c) => c.id === v)?.name ?? v
    );
    if (committees) parts.push(`in ${committees}`);
    const teams = label(
      audience.teams,
      (v) =>
        options.committees.flatMap((c) => c.teams).find((t) => t.id === v)
          ?.name ?? v
    );
    if (teams) parts.push(`team ${teams}`);
    if (audience.leadership?.length)
      parts.push(
        audience.leadership.includes("any")
          ? "active leaders"
          : audience.leadership
              .map(
                (p) => options.positions.find((x) => x.id === p)?.label.en ?? p
              )
              .join(" or ")
      );
    const status = audience.statuses?.length
      ? audience.statuses.join(" or ")
      : "member";
    let text = parts.length ? parts.join(", ") : "Every eligible member";
    text += ` · status: ${status}`;
    if (audience.include?.length)
      text += ` · plus ${audience.include.length} chosen`;
    if (audience.exclude?.length)
      text += ` · minus ${audience.exclude.length} excluded`;
    return text;
  }, [audience, options]);

  async function save(): Promise<number | null> {
    const result = await saveDraftAction(campaign.id, revision, payload);
    if (result.code === "SUCCESS" && typeof result.revision === "number") {
      setRevision(result.revision);
      setDirty(false);
      return result.revision;
    }
    toast.error(result.message);
    return null;
  }

  const addName = (m: { id: string; name: string; email: string }) =>
    setNames((current) =>
      new Map(current).set(m.id, { name: m.name, email: m.email })
    );

  useEffect(() => {
    // Names for members picked before the page loaded but not yet named.
    const missing = [
      ...(audience.include ?? []),
      ...(audience.exclude ?? []),
    ].filter((id) => !names.has(id));
    if (missing.length)
      memberNamesAction(missing).then((list) => list.forEach(addName));
    // Only when the picked lists change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience.include, audience.exclude]);

  return (
    <div className="flex flex-col gap-6">
      {sending.enabled ? null : (
        <Alert>
          <AlertTitle>Sending is turned off</AlertTitle>
          <AlertDescription>
            {sending.reason} You can still build the audience, write and preview
            the message, and save it as a draft or a template.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-6 @5xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Audience</CardTitle>
            <CardDescription>
              Different filters narrow the audience together; several values in
              one filter match any of them. Unsubscribed ({options.unsubscribed}
              ) and suppressed ({options.suppressed}) addresses are always left
              out.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Chips
              label="Membership status"
              hint="None selected: active members only (status Member)."
              options={[
                { value: "member" as const, label: "Member" },
                { value: "graduate" as const, label: "Graduate" },
              ]}
              selected={audience.statuses ?? []}
              onChange={(v) => setFilter("statuses", v)}
            />
            <Chips
              label="Member category"
              options={options.categories.map((c) => ({
                value: c.id,
                label: c.label.en,
              }))}
              selected={audience.categories ?? []}
              onChange={(v) => setFilter("categories", v)}
            />
            <Chips
              label="University or institution"
              hint="What members reported when applying. It is not SQU verification."
              options={options.institutions.map((i) => ({
                value: i.id,
                label: i.name.en,
              }))}
              selected={audience.institutions ?? []}
              onChange={(v) => setFilter("institutions", v)}
            />
            <Chips
              label="Academic year"
              hint="Only University Students have an academic year: choosing a year leaves out every other category."
              options={[1, 2, 3, 4, 5, 6, 7].map((y) => ({
                value: y,
                label: `Year ${y}`,
              }))}
              selected={audience.years ?? []}
              onChange={(v) => setFilter("years", v)}
            />
            <Chips
              label="Discipline"
              options={options.disciplines.map((d) => ({
                value: d,
                label: DISCIPLINES[d] ?? d,
              }))}
              selected={audience.disciplines ?? []}
              onChange={(v) => setFilter("disciplines", v)}
            />
            <Chips
              label="Interests"
              options={options.interests.map((i) => ({
                value: i,
                label: INTERESTS[i] ?? i,
              }))}
              selected={audience.interests ?? []}
              onChange={(v) => setFilter("interests", v)}
            />
            <Chips
              label="SQU verification"
              hint="Verified by a reviewer, separate from the self-reported institution."
              options={[
                { value: "verified" as const, label: "Verified" },
                { value: "pending" as const, label: "Pending review" },
                { value: "not_verified" as const, label: "Not verified" },
              ]}
              selected={audience.squ ?? []}
              onChange={(v) => setFilter("squ", v)}
            />
            <Chips
              label="Committee"
              hint="Roster members and leaders of the committee (committee level or any of its teams)."
              options={options.committees.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              selected={audience.committees ?? []}
              onChange={(v) => setFilter("committees", v)}
            />
            {(audience.committees ?? []).length ? (
              <Chips
                label="Team (optional)"
                hint="Leaders of these teams."
                options={options.committees
                  .filter((c) => audience.committees!.includes(c.id))
                  .flatMap((c) =>
                    c.teams.map((t) => ({
                      value: t.id,
                      label: `${t.name} (${c.name})`,
                    }))
                  )}
                selected={audience.teams ?? []}
                onChange={(v) => setFilter("teams", v)}
              />
            ) : null}
            <Chips
              label="Leadership"
              hint="Active appointments; with a committee or team chosen, in that committee or team."
              options={[
                ...options.positions.map((p) => ({
                  value: p.id as "chief" | "assistant_chief",
                  label: p.label.en,
                })),
                { value: "any" as const, label: "All active leaders" },
              ]}
              selected={audience.leadership ?? []}
              onChange={(v) =>
                setFilter("leadership", v as Audience["leadership"])
              }
            />
            <MemberPicker
              label="Also include"
              ids={audience.include ?? []}
              names={names}
              onName={addName}
              onChange={(v) => setFilter("include", v)}
            />
            <MemberPicker
              label="Exclude"
              ids={audience.exclude ?? []}
              names={names}
              onName={addName}
              onChange={(v) => setFilter("exclude", v)}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Recipients
              {loading ? <Spinner aria-label="Updating" /> : null}
            </CardTitle>
            <CardDescription aria-live="polite">
              {preview
                ? `${preview.count} eligible member${preview.count === 1 ? "" : "s"}, each sent an individual message.`
                : "Counting…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{summary}</p>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
                placeholder="Search the audience by name or email"
                aria-label="Search the audience"
                className="pl-8"
              />
            </div>
            {previewError ? (
              <p role="alert" className="text-sm text-destructive">
                {previewError}
              </p>
            ) : null}
            {preview && preview.recipients.length ? (
              <ul
                className="flex flex-col divide-y rounded-md border text-sm"
                aria-label="Recipients"
              >
                {preview.recipients.map((r) => (
                  <li key={r.id} className="flex flex-col px-3 py-1.5">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs break-all text-muted-foreground">
                      {r.email}
                      {r.squVerified ? " · SQU verified" : ""}
                      {r.leader ? " · leader" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : preview ? (
              <p className="text-sm text-muted-foreground">
                No member matches.
              </p>
            ) : null}
            {preview && preview.matching > PAGE ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Previous
                </Button>
                <span className="tabular-nums text-muted-foreground">
                  {offset + 1}–{Math.min(offset + PAGE, preview.matching)} of{" "}
                  {preview.matching}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE >= preview.matching}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Message</CardTitle>
          <CardDescription>
            Formatting: a blank line starts a paragraph; # Heading, - list item,
            **bold**, *italic*, [link text](https://…). {"{{name}}"} inserts the
            member&apos;s name. HTML is shown as typed, never run.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-4">
            <Chips
              label="Language"
              options={[
                { value: "en" as const, label: "English" },
                { value: "ar" as const, label: "Arabic" },
                { value: "both" as const, label: "Both" },
              ]}
              selected={[content.language]}
              onChange={(v) => {
                const next =
                  v.find((x) => x !== content.language) ?? content.language;
                set("language", next);
              }}
            />
            {templates.length ? (
              <div className="grid gap-1.5">
                <Label htmlFor="email-template">Start from a template</Label>
                <select
                  id="email-template"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  defaultValue=""
                  onChange={(event) => {
                    const t = templates.find(
                      (x) => x.id === event.target.value
                    );
                    if (!t) return;
                    setContent((c) => ({
                      ...c,
                      subjectEn: t.subjectEn ?? "",
                      subjectAr: t.subjectAr ?? "",
                      bodyEn: t.bodyEn ?? "",
                      bodyAr: t.bodyAr ?? "",
                    }));
                    setDirty(true);
                    setRendered(null);
                    event.target.value = "";
                  }}
                >
                  <option value="">Choose a template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className="grid gap-6 @3xl/main:grid-cols-2">
            {needsEn ? (
              <div className="flex flex-col gap-3" lang="en">
                <div className="grid gap-1.5">
                  <Label htmlFor="subject-en">Subject (English)</Label>
                  <Input
                    id="subject-en"
                    value={content.subjectEn}
                    maxLength={200}
                    onChange={(e) => set("subjectEn", e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="body-en">Message (English)</Label>
                  <Textarea
                    id="body-en"
                    rows={12}
                    value={content.bodyEn}
                    maxLength={20000}
                    onChange={(e) => set("bodyEn", e.target.value)}
                  />
                </div>
              </div>
            ) : null}
            {needsAr ? (
              <div className="flex flex-col gap-3" lang="ar" dir="rtl">
                <div className="grid gap-1.5">
                  <Label htmlFor="subject-ar">الموضوع (Arabic subject)</Label>
                  <Input
                    id="subject-ar"
                    dir="rtl"
                    value={content.subjectAr}
                    maxLength={200}
                    onChange={(e) => set("subjectAr", e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="body-ar">الرسالة (Arabic message)</Label>
                  <Textarea
                    id="body-ar"
                    dir="rtl"
                    rows={12}
                    value={content.bodyAr}
                    maxLength={20000}
                    onChange={(e) => set("bodyAr", e.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                start(async () =>
                  setRendered(await renderPreviewAction(payload))
                )
              }
            >
              <Eye aria-hidden="true" data-icon="inline-start" />
              Preview message
            </Button>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="template-name">Template name</Label>
                <Input
                  id="template-name"
                  value={templateName}
                  maxLength={120}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="w-56"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !templateName.trim()}
                onClick={() =>
                  start(async () => {
                    const result = await saveTemplateAction({
                      ...content,
                      name: templateName,
                    });
                    if (result.code === "SUCCESS") {
                      toast.success(result.message);
                      setTemplateName("");
                      router.refresh();
                    } else toast.error(result.message);
                  })
                }
              >
                Save as template
              </Button>
            </div>
          </div>
          {rendered ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Subject: </span>
                <span dir="auto">{rendered.subject || "—"}</span>
              </p>
              <iframe
                title="Message preview"
                sandbox=""
                srcDoc={rendered.html}
                className="h-[28rem] w-full rounded-md border bg-white"
              />
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Plain-text version
                </summary>
                <pre
                  className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap"
                  dir="auto"
                >
                  {rendered.text}
                </pre>
              </details>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review and send</CardTitle>
          <CardDescription>
            Save as often as you like. A test goes only to{" "}
            {actorEmail ?? "your own address"}. Sending asks you to confirm the
            audience and the exact number of recipients; it runs in the
            background and can be stopped.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || !dirty}
            onClick={() =>
              start(async () => {
                if (await save()) toast.success("Draft saved.");
              })
            }
          >
            <Save aria-hidden="true" data-icon="inline-start" />
            {dirty ? "Save draft" : "Saved"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !sending.enabled || !complete}
            onClick={() =>
              start(async () => {
                if (dirty && !(await save())) return;
                const result = await sendTestAction(campaign.id, payload);
                if (result.code === "SUCCESS") toast.success(result.message);
                else toast.error(result.message);
              })
            }
          >
            <TestTube2 aria-hidden="true" data-icon="inline-start" />
            Send me a test
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              !sending.enabled ||
              !complete ||
              !preview ||
              preview.count === 0
            }
            onClick={() => setConfirm(preview?.count ?? 0)}
          >
            <Send aria-hidden="true" data-icon="inline-start" />
            Send to {preview?.count ?? "…"} members
          </Button>
          {!complete ? (
            <p className="w-full text-sm text-muted-foreground">
              Add a subject and a message for{" "}
              {content.language === "both"
                ? "both languages"
                : content.language === "ar"
                  ? "Arabic"
                  : "English"}{" "}
              to send.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {confirm} members?</AlertDialogTitle>
            <AlertDialogDescription>
              {summary}. Each member receives an individual message in{" "}
              {content.language === "both"
                ? "English and Arabic"
                : content.language === "ar"
                  ? "Arabic"
                  : "English"}
              . Members who unsubscribe or become ineligible before their
              message is sent are skipped. This cannot be undone once messages
              are accepted by the provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                start(async () => {
                  const rev = dirty ? await save() : revision;
                  if (!rev || confirm === null) return;
                  const result = await queueCampaignAction(
                    campaign.id,
                    rev,
                    confirm
                  );
                  if (
                    result.code === "AUDIENCE_CHANGED" &&
                    typeof result.count === "number"
                  ) {
                    setConfirm(result.count);
                    toast.warning(result.message);
                    return;
                  }
                  setConfirm(null);
                  if (result.code === "SUCCESS") {
                    toast.success(result.message);
                    router.refresh();
                  } else toast.error(result.message);
                });
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Send to {confirm} members
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
