import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ProjectContent } from "@/lib/projects/content";
import { projectContent } from "../fixtures/project-content";
import { adminDb, runtimeDb, close, createFixture } from "./helpers";

type Result = {
  code: string;
  id?: string;
  revision?: number;
  total?: number;
  hasMore?: boolean;
  projects?: {
    id: string;
    revision: number;
    status: string;
    content: ProjectContent;
    historyTotal: number;
    publishedMediaIds?: string[];
    history: { action: string; feedback: string | null }[];
  }[];
};

describe("reviewed member projects (real restricted runtime and browser roles)", () => {
  const admin = adminDb();
  const runtime = runtimeDb();
  afterAll(() => close(admin, runtime));
  async function call<T = Result>(name: string, values: unknown[]): Promise<T> {
    const [row] = await runtime.unsafe(
      `SELECT private.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) AS result`,
      values as never[]
    );
    return row.result as T;
  }
  async function member(
    status: "member" | "graduate" = "member",
    confirmed = true
  ) {
    const id = randomUUID();
    const email = `${id}@example.test`;
    await admin`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${id},${email},${confirmed ? new Date() : null})`;
    await admin`INSERT INTO public.members(id,full_name,email,university_id,status) VALUES(${id},'Synthetic Project Author',${email},${id},${status})`;
    return id;
  }
  async function fixture() {
    const other = await createFixture(admin);
    const manager = randomUUID();
    const technical = randomUUID();
    const [{ id: committee }] =
      await admin`SELECT id FROM public.committees WHERE slug='society-affairs'`;
    await admin`INSERT INTO auth.users(id) VALUES(${manager}),(${technical})`;
    await admin`INSERT INTO public.administrative_access(user_id,committee_id,granted_by) VALUES(${manager},${committee},${manager})`;
    await admin`INSERT INTO public.administrative_access(user_id,access_level,granted_by) VALUES(${technical},'TECHNICAL',${technical})`;
    return {
      author: await member(),
      manager,
      technical,
      board: other.boardReviewerId,
      wrongManager: other.managerId,
    };
  }
  const write = (
    actor: string | null,
    id: string | null,
    revision: number | null,
    operation: string,
    content: ProjectContent | null = null,
    feedback: string | null = null,
    attest = false
  ) =>
    call("project_write", [
      actor,
      id,
      revision,
      operation,
      content ? runtime.json(content) : null,
      feedback,
      attest,
    ]);
  const read = (
    actor: string | null,
    id: string | null,
    review = false,
    status = "all",
    search = "",
    offset: number | null = 0
  ) => call("project_read", [actor, id, review, status, search, offset]);
  async function create(actor: string, content = projectContent()) {
    const result = await write(actor, null, null, "create", content);
    expect(result.code).toBe("SUCCESS");
    return result.id!;
  }
  async function review(
    author: string,
    reviewer: string,
    id: string,
    revision = 1
  ) {
    expect((await write(author, id, revision, "submit")).code).toBe("SUCCESS");
    expect((await write(reviewer, id, revision, "start_review")).code).toBe(
      "SUCCESS"
    );
  }
  async function publish(
    author: string,
    reviewer: string,
    id: string,
    revision = 1
  ) {
    await review(author, reviewer, id, revision);
    expect(
      (await write(reviewer, id, revision, "approve", null, null, true)).code
    ).toBe("SUCCESS");
    expect((await write(reviewer, id, revision, "publish")).code).toBe(
      "SUCCESS"
    );
  }
  const media = (
    actor: string,
    id: string,
    operation: string,
    mediaId: string | null = null,
    key: string | null = null
  ) => call("project_media_change", [actor, id, operation, mediaId, key]);
  const key = (actor: string | null, id: string, mediaId: string | null) =>
    call<string | null>("project_media_key", [actor, id, mediaId]);

  it("requires a confirmed active member and protects author identity and committee scope", async () => {
    const f = await fixture();
    const graduate = await member("graduate");
    const unconfirmed = await member("member", false);
    for (const actor of [
      null,
      randomUUID(),
      f.manager,
      graduate,
      unconfirmed,
    ]) {
      expect(
        (await write(actor, null, null, "create", projectContent())).code
      ).toBe("MEMBER_REQUIRED");
      expect((await read(actor, null)).code).toBe("MEMBER_REQUIRED");
    }
    const id = await create(f.author);
    const stranger = await member();
    expect((await read(stranger, id)).code).toBe("NOT_FOUND");
    expect(
      (await write(stranger, id, 1, "save", projectContent("Impersonated")))
        .code
    ).toBe("NOT_FOUND");
    expect((await write(f.wrongManager, id, 1, "start_review")).code).toBe(
      "FORBIDDEN"
    );
    expect((await read(f.wrongManager, id, true)).code).toBe("FORBIDDEN");
    for (const actor of [f.manager, f.board, f.technical])
      expect((await read(actor, id, true)).projects?.[0].id).toBe(id);
    const [row] =
      await admin`SELECT member_id,c.slug FROM private.projects p JOIN public.committees c ON c.id=p.committee_id WHERE p.id=${id}`;
    expect(row).toMatchObject({ member_id: f.author, slug: "society-affairs" });
    await admin`UPDATE public.administrative_access SET revoked_at=now() WHERE user_id=${f.manager}`;
    expect((await read(f.manager, id, true)).code).toBe("FORBIDDEN");
  });

  it("requires explicit submission, start of review, approval and separate publication with durable history", async () => {
    const f = await fixture();
    const id = await create(f.author);
    expect(
      (await write(f.manager, id, 1, "approve", null, null, true)).code
    ).toBe("INVALID_TRANSITION");
    expect((await write(f.manager, id, 1, "publish")).code).toBe(
      "INVALID_TRANSITION"
    );
    expect((await write(f.author, id, 1, "submit")).code).toBe("SUCCESS");
    expect((await read(f.author, id)).projects?.[0].status).toBe("submitted");
    expect((await write(f.author, id, 1, "save", projectContent())).code).toBe(
      "INVALID_TRANSITION"
    );
    expect(
      (await write(f.board, id, 1, "approve", null, null, true)).code
    ).toBe("INVALID_TRANSITION");
    expect((await write(f.manager, id, 1, "start_review")).code).toBe(
      "SUCCESS"
    );
    expect((await read(f.author, id)).projects?.[0].status).toBe(
      "under_review"
    );
    expect((await write(f.technical, id, 1, "approve")).code).toBe(
      "SELF_REVIEW"
    );
    expect(
      (
        await write(
          f.technical,
          id,
          1,
          "approve",
          null,
          "Independent review completed.",
          true
        )
      ).code
    ).toBe("SUCCESS");
    expect((await call("public_projects", [id])).projects).toEqual([]);
    expect((await write(f.author, id, 1, "save", projectContent())).code).toBe(
      "INVALID_TRANSITION"
    );
    expect((await write(f.board, id, 1, "publish")).code).toBe("SUCCESS");
    expect((await call("public_projects", [id])).projects?.[0].revision).toBe(
      1
    );
    expect((await write(f.board, id, 1, "publish")).code).toBe("SUCCESS");
    const history = (await read(f.author, id)).projects?.[0].history;
    expect(history?.map((h) => h.action)).toEqual([
      "created",
      "submitted",
      "under_review",
      "approved",
      "published",
    ]);
    expect(history?.find((h) => h.action === "approved")?.feedback).toBe(
      "Independent review completed."
    );
  });

  it("rejects stale edits and serializes simultaneous reviews without duplicate decisions", async () => {
    const f = await fixture();
    const id = await create(f.author);
    expect(
      (await write(f.author, id, 1, "save", projectContent("Version two")))
        .revision
    ).toBe(2);
    expect(
      (await write(f.author, id, 1, "save", projectContent("Stale overwrite")))
        .code
    ).toBe("STALE_REVISION");
    await review(f.author, f.manager, id, 2);
    expect(
      (await write(f.board, id, 1, "approve", null, null, true)).code
    ).toBe("STALE_REVISION");
    const results = await Promise.all([
      write(f.board, id, 2, "approve", null, "Board reviewed.", true),
      write(f.technical, id, 2, "approve", null, "Technical reviewed.", true),
    ]);
    expect(results.map((r) => r.code).sort()).toEqual([
      "INVALID_TRANSITION",
      "SUCCESS",
    ]);
    const [{ count }] =
      await admin`SELECT count(*)::integer AS count FROM private.project_history WHERE project_id=${id} AND action='approved'`;
    expect(count).toBe(1);
    expect((await write(f.manager, id, 1, "publish")).code).toBe(
      "STALE_REVISION"
    );
  });

  it("accepts fully Arabic required content through review and publication without requiring English", async () => {
    const f = await fixture();
    const content = projectContent();
    const required = ["title", "summary", "problem", "solution"] as const;
    for (const field of required)
      content[field] = { en: "", ar: "مشروع هندسي ونتائج موثقة" };
    content.technicalApproach.overview = {
      en: " \t\n",
      ar: "منهج هندسي قابل للقياس",
    };
    const id = await create(f.author, content);
    await publish(f.author, f.manager, id);
    const published = (await call("public_projects", [id])).projects?.[0]
      .content;
    expect(published?.title).toEqual(content.title);
    expect(published?.technicalApproach.overview.ar).toBe(
      "منهج هندسي قابل للقياس"
    );
    const incomplete = projectContent();
    incomplete.title = { en: " \t\n", ar: " \t\n" };
    const invalid = await create(f.author, incomplete);
    expect((await write(f.author, invalid, 1, "submit")).code).toBe(
      "INVALID_TRANSITION"
    );
  });

  it("requires meaningful review feedback, retains decisions and rejects incomplete submissions", async () => {
    const f = await fixture();
    for (const field of ["title", "summary", "problem", "solution"] as const) {
      const content = projectContent();
      content[field].en = " \t\n";
      const id = await create(f.author, content);
      expect((await write(f.author, id, 1, "submit")).code).toBe(
        "INVALID_TRANSITION"
      );
    }
    for (const operation of ["reject", "request_changes"]) {
      const id = await create(f.author);
      await review(f.author, f.manager, id);
      for (const feedback of [null, "", " \t\n", "x".repeat(2001)])
        expect(
          (await write(f.manager, id, 1, operation, null, feedback)).code
        ).toBe("VALIDATION_ERROR");
      const feedback = "Please include measured validation results.";
      expect(
        (await write(f.manager, id, 1, operation, null, feedback)).code
      ).toBe("SUCCESS");
      expect((await call("public_projects", [id])).projects).toEqual([]);
      expect(
        (await write(f.author, id, 1, "save", projectContent("Revised")))
          .revision
      ).toBe(2);
      const history = (await read(f.author, id)).projects?.[0].history;
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: operation === "reject" ? "rejected" : "changes_requested",
            feedback,
          }),
        ])
      );
    }
  });

  it("prevents authors and linked contributors from reviewing, including uppercase identity representations", async () => {
    const f = await fixture();
    const [{ id: committee }] =
      await admin`SELECT id FROM public.committees WHERE slug='society-affairs'`;
    await admin`INSERT INTO public.administrative_access(user_id,committee_id,granted_by) VALUES(${f.author},${committee},${f.manager})`;
    const content = projectContent();
    content.team = [
      {
        name: { en: "Technical Contributor", ar: "" },
        role: { en: "Design", ar: "" },
        memberId: f.technical.toUpperCase(),
      },
    ];
    const id = await create(f.author, content);
    expect((await write(f.author, id, 1, "submit")).code).toBe("SUCCESS");
    for (const actor of [f.author, f.technical])
      expect((await write(actor, id, 1, "start_review")).code).toBe(
        "SELF_REVIEW"
      );
    expect((await write(f.manager, id, 1, "start_review")).code).toBe(
      "SUCCESS"
    );
    for (const actor of [f.author, f.technical])
      for (const operation of ["approve", "reject", "request_changes"])
        expect(
          (await write(actor, id, 1, operation, null, "A review.", true)).code
        ).toBe("SELF_REVIEW");
    expect(
      (await write(f.board, id, 1, "approve", null, null, true)).code
    ).toBe("SUCCESS");
    for (const actor of [f.author, f.technical])
      expect((await write(actor, id, 1, "publish")).code).toBe("SELF_REVIEW");
  });

  it("keeps the published snapshot while revisions undergo review, and unpublishes immediately", async () => {
    const f = await fixture();
    const id = await create(
      f.author,
      projectContent("Original public version")
    );
    await publish(f.author, f.manager, id);
    expect(
      (await write(f.author, id, 1, "save", projectContent("Private revision")))
        .revision
    ).toBe(2);
    await review(f.author, f.board, id, 2);
    expect(
      (await call("public_projects", [id])).projects?.[0].content.title.en
    ).toBe("Original public version");
    expect(
      (await write(f.technical, id, 2, "approve", null, null, true)).code
    ).toBe("SUCCESS");
    expect((await call("public_projects", [id])).projects?.[0].revision).toBe(
      1
    );
    expect((await write(f.manager, id, 2, "publish")).code).toBe("SUCCESS");
    const published = (await call("public_projects", [id])).projects?.[0];
    expect(published?.content.title.en).toBe("Private revision");
    expect(Object.keys(published!).sort()).toEqual([
      "content",
      "id",
      "revision",
    ]);
    expect((await write(f.manager, id, 2, "unpublish")).code).toBe("SUCCESS");
    expect((await call("public_projects", [id])).projects).toEqual([]);
  });

  it("paginates public cards without dropping older publications and keeps full detail separate", async () => {
    const f = await fixture();
    const [{ count: baseline }] =
      await admin`SELECT count(*)::integer AS count FROM private.projects WHERE published_content IS NOT NULL`;
    const content = projectContent("Synthetic paginated publication");
    content.links = [
      {
        label: { en: "Research source", ar: "" },
        href: "https://example.test/research",
      },
    ];
    // These fixture rows isolate read projection/pagination; lifecycle authorization is tested above.
    const seeded =
      await admin`INSERT INTO private.projects(member_id,committee_id,content,status,approved_revision,published_revision,published_content,created_at)
      SELECT ${f.author},c.id,${admin.json(content)},'approved',1,1,${admin.json(content)},now()+series.n*interval '1 day'
      FROM public.committees c CROSS JOIN generate_series(1,31) AS series(n) WHERE c.slug='society-affairs' RETURNING id`;
    const seedIds = new Set(seeded.map((row) => row.id as string));
    const first = await call("public_projects", [null, 0]);
    expect(first).toMatchObject({
      code: "SUCCESS",
      total: baseline + 31,
      hasMore: true,
    });
    expect(first.projects).toHaveLength(30);
    expect(first.projects?.every((p) => seedIds.has(p.id))).toBe(true);
    expect(first.projects?.[0].content.problem).toEqual({ en: "", ar: "" });
    expect(first.projects?.[0].content.links).toEqual([]);
    const second = await call("public_projects", [null, 30]);
    const secondSeedIds =
      second.projects?.filter((p) => seedIds.has(p.id)).map((p) => p.id) ?? [];
    expect(secondSeedIds).toHaveLength(1);
    const ids = [...first.projects!.map((p) => p.id), ...secondSeedIds];
    expect(new Set(ids)).toEqual(seedIds);
    const detail = await call("public_projects", [seeded[0].id, 0]);
    expect(detail).toMatchObject({ code: "SUCCESS", total: 1, hasMore: false });
    expect(detail.projects?.[0].content.problem).toEqual(content.problem);
    expect(detail.projects?.[0].content.links).toEqual(content.links);
    expect((await call("public_projects", [null, -1])).code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("bounds detail and list history without deleting the durable audit trail", async () => {
    const f = await fixture();
    const id = await create(f.author);
    await admin`INSERT INTO private.project_history(project_id,actor_id,revision,action,feedback,occurred_at)
      SELECT ${id},${f.author},1,'saved','Synthetic history '||series.n,(now()+interval '1 day')+series.n*interval '1 millisecond'
      FROM generate_series(1,105) AS series(n)`;
    const detail = (await read(f.author, id)).projects?.[0];
    expect(detail?.historyTotal).toBe(106);
    expect(detail?.history).toHaveLength(100);
    expect(detail?.history[0].feedback).toBe("Synthetic history 6");
    expect(detail?.history.at(-1)?.feedback).toBe("Synthetic history 105");
    const list = (await read(f.author, null)).projects?.find(
      (p) => p.id === id
    );
    expect(list?.historyTotal).toBe(106);
    expect(list?.history).toEqual([
      expect.objectContaining({ feedback: "Synthetic history 105" }),
    ]);
    const [{ count }] =
      await admin`SELECT count(*)::integer AS count FROM private.project_history WHERE project_id=${id}`;
    expect(count).toBe(106);
  });

  it("keeps draft/rejected media private and permits only media in the published snapshot", async () => {
    const f = await fixture();
    const stranger = await member();
    const id = await create(f.author);
    const imageKey = `project-images/${randomUUID()}.png`;
    const image = await media(f.author, id, "add", null, imageKey);
    expect(image.code).toBe("SUCCESS");
    for (const actor of [null, stranger, f.wrongManager])
      expect(await key(actor, id, image.id!)).toBeNull();
    expect(await key(null, id, null)).toBeNull();
    expect(await key(f.author, id, image.id!)).toBe(imageKey);
    expect(await key(f.board, id, image.id!)).toBe(imageKey);
    expect((await media(stranger, id, "remove", image.id!)).code).toBe(
      "NOT_FOUND"
    );
    const foreign = await create(stranger);
    const content = projectContent();
    content.mediaIds = [image.id!];
    expect((await write(stranger, foreign, 1, "save", content)).code).toBe(
      "VALIDATION_ERROR"
    );
    expect((await write(f.author, id, 1, "save", content)).revision).toBe(2);
    await review(f.author, f.manager, id, 2);
    expect(
      (
        await media(
          f.author,
          id,
          "add",
          null,
          `project-images/${randomUUID()}.jpg`
        )
      ).code
    ).toBe("INVALID_TRANSITION");
    expect(
      (await write(f.manager, id, 2, "reject", null, "Incomplete validation."))
        .code
    ).toBe("SUCCESS");
    expect(await key(null, id, image.id!)).toBeNull();
    expect((await write(f.author, id, 2, "save", content)).revision).toBe(3);
    await publish(f.author, f.manager, id, 3);
    expect(await key(null, id, image.id!)).toBe(imageKey);
    const extra = await media(
      f.author,
      id,
      "add",
      null,
      `project-images/${randomUUID()}.jpg`
    );
    expect(extra.code).toBe("SUCCESS");
    expect(await key(null, id, extra.id!)).toBeNull();
    expect(
      (
        await write(
          f.author,
          id,
          3,
          "save",
          projectContent("New draft without image")
        )
      ).revision
    ).toBe(4);
    expect((await media(f.author, id, "remove", image.id!)).code).toBe(
      "MEDIA_IN_USE"
    );
    expect((await write(f.manager, id, 4, "unpublish")).code).toBe("SUCCESS");
    expect(await key(null, id, image.id!)).toBeNull();
    expect((await media(f.author, id, "remove", image.id!)).code).toBe(
      "SUCCESS"
    );
  });

  it("replaces a full six-image gallery while preserving the published media until the next approved snapshot", async () => {
    const f = await fixture();
    const content = projectContent("Original six-image gallery");
    const id = await create(f.author, content);
    const original: { id: string; key: string }[] = [];
    const replacements: { id: string; key: string }[] = [];
    for (let n = 0; n < 6; n++) {
      const objectKey = `project-images/${randomUUID()}.png`;
      const added = await media(f.author, id, "add", null, objectKey);
      expect(added.code).toBe("SUCCESS");
      original.push({ id: added.id!, key: objectKey });
    }
    content.mediaIds = original.map((image) => image.id);
    expect((await write(f.author, id, 1, "save", content)).revision).toBe(2);
    await publish(f.author, f.manager, id, 2);
    expect((await read(f.author, id)).projects?.[0].publishedMediaIds).toEqual(
      content.mediaIds
    );
    for (let n = 0; n < 6; n++) {
      const objectKey = `project-images/${randomUUID()}.jpg`;
      const added = await media(f.author, id, "add", null, objectKey);
      expect(added.code).toBe("SUCCESS");
      replacements.push({ id: added.id!, key: objectKey });
    }
    expect(
      (
        await media(
          f.author,
          id,
          "add",
          null,
          `project-images/${randomUUID()}.png`
        )
      ).code
    ).toBe("MEDIA_LIMIT");
    const replacement = projectContent("Replacement six-image gallery");
    replacement.mediaIds = [...original, ...replacements].map(
      (image) => image.id
    );
    expect((await write(f.author, id, 2, "save", replacement)).code).toBe(
      "VALIDATION_ERROR"
    );
    replacement.mediaIds = replacements.map((image) => image.id);
    expect((await write(f.author, id, 2, "save", replacement)).revision).toBe(
      3
    );
    expect((await read(f.author, id)).projects?.[0].publishedMediaIds).toEqual(
      content.mediaIds
    );
    for (const image of original) {
      expect(await key(null, id, image.id)).toBe(image.key);
      expect((await media(f.author, id, "remove", image.id)).code).toBe(
        "MEDIA_IN_USE"
      );
    }
    for (const image of replacements)
      expect(await key(null, id, image.id)).toBeNull();
    await publish(f.author, f.manager, id, 3);
    expect((await read(f.author, id)).projects?.[0].publishedMediaIds).toEqual(
      replacement.mediaIds
    );
    for (const image of original) {
      expect(await key(null, id, image.id)).toBeNull();
      expect(await key(f.author, id, image.id)).toBe(image.key);
    }
    for (const image of replacements)
      expect(await key(null, id, image.id)).toBe(image.key);
  });

  it("bounds listing, filters working state and prevents direct table/routine access by browser roles", async () => {
    const f = await fixture();
    const title = `Searchable ${randomUUID()}`;
    const id = await create(f.author, projectContent(title));
    expect(
      (
        await read(f.author, null, false, "draft", title.toUpperCase())
      ).projects?.map((p) => p.id)
    ).toEqual([id]);
    expect((await read(f.author, null, false, "submitted", title)).total).toBe(
      0
    );
    expect(
      (await read(f.author, null, false, "all", title, 1)).projects
    ).toEqual([]);
    for (const offset of [-1, 10001, null])
      expect((await read(f.author, null, false, "all", "", offset)).code).toBe(
        "VALIDATION_ERROR"
      );
    const protections =
      await admin`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('private.projects'::regclass,'private.project_media'::regclass,'private.project_history'::regclass)`;
    expect(protections).toHaveLength(3);
    for (const table of protections)
      expect(table).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
    const browser = await admin.reserve();
    try {
      for (const role of ["anon", "authenticated"]) {
        await browser.unsafe(`SET ROLE ${role}`);
        try {
          await expect(
            browser`SELECT * FROM private.projects`
          ).rejects.toMatchObject({ code: "42501" });
          await expect(
            browser`SELECT private.project_write(${f.author}::uuid,NULL,NULL,'create',${JSON.stringify(projectContent())}::jsonb)`
          ).rejects.toMatchObject({ code: "42501" });
          await expect(
            browser`SELECT private.public_projects()`
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await browser.unsafe("RESET ROLE");
        }
      }
    } finally {
      browser.release();
    }
    await expect(runtime`SELECT * FROM private.projects`).rejects.toMatchObject(
      { code: "42501" }
    );
    await expect(
      runtime`DELETE FROM private.project_history WHERE project_id=${id}`
    ).rejects.toMatchObject({ code: "42501" });
    expect((await read(f.author, id)).projects?.[0].content.title.en).toBe(
      title
    );
  });
});
