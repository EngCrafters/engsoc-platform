export const DISCIPLINES = [
  "mechanical",
  "electrical",
  "civil",
  "petroleum",
  "chemical",
  "mechatronics",
  "industrial",
] as const;
export const TYPES = ["capstone", "competition", "research", "course"] as const;
export const STAGES = [
  "idea",
  "research",
  "development",
  "prototype",
  "testing",
  "competition-ready",
  "completed",
] as const;
export const TECHNOLOGIES = [
  "arduino",
  "esp32",
  "raspberrypi",
  "matlab",
  "python",
  "solidworks",
  "ansys",
  "autocad",
  "aspen",
  "lora",
  "vision",
  "plc",
  "printing",
  "sensors",
] as const;
export type Localized = { en: string; ar: string };
export type ProjectContent = {
  title: Localized;
  summary: Localized;
  discipline: (typeof DISCIPLINES)[number];
  alsoDisciplines: (typeof DISCIPLINES)[number][];
  year: number;
  type: (typeof TYPES)[number];
  stage: (typeof STAGES)[number];
  technologies: (typeof TECHNOLOGIES)[number][];
  problem: Localized;
  solution: Localized;
  technicalApproach: { overview: Localized; decisions: Localized[] };
  development: Localized[];
  validation: { measure: Localized; result: Localized }[];
  nextSteps: Localized;
  collaboration: { seeking: Localized; application: Localized };
  parts: { name: Localized; qty: number }[];
  achievements: {
    competition: Localized;
    result:
      | "winner"
      | "first"
      | "second"
      | "third"
      | "finalist"
      | "special"
      | "participant";
    year: number;
    href?: string;
    sample: false;
  }[];
  team: { name: Localized; role: Localized; memberId?: string }[];
  links: { label: Localized; href: string }[];
  mediaIds: string[];
};
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ObjectValue = Record<string, unknown>;
function object(v: unknown, keys: string[]): v is ObjectValue {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).every((k) => keys.includes(k))
  );
}
function text(v: unknown, max = 10000): v is string {
  return (
    typeof v === "string" &&
    v.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)
  );
}
function localized(v: unknown, max = 10000): v is Localized {
  return object(v, ["en", "ar"]) && text(v.en, max) && text(v.ar, max);
}
function array(
  v: unknown,
  predicate: (x: unknown) => boolean,
  max = 30
): boolean {
  return Array.isArray(v) && v.length <= max && v.every(predicate);
}
function choice(v: unknown, values: readonly string[]): boolean {
  return typeof v === "string" && values.includes(v);
}
export function safeProjectLink(v: unknown): v is string {
  if (!text(v, 2000)) return false;
  try {
    const u = new URL(v);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !/[\s@]/.test(v) &&
      /^https?:\/\/[a-z0-9]/i.test(v)
    );
  } catch {
    return false;
  }
}
/** Strict DTO from the existing Projects design; no privileged or storage fields. */
export function isProjectContent(v: unknown): v is ProjectContent {
  if (
    !object(v, [
      "title",
      "summary",
      "discipline",
      "alsoDisciplines",
      "year",
      "type",
      "stage",
      "technologies",
      "problem",
      "solution",
      "technicalApproach",
      "development",
      "validation",
      "nextSteps",
      "collaboration",
      "parts",
      "achievements",
      "team",
      "links",
      "mediaIds",
    ]) ||
    JSON.stringify(v).length > 65536
  )
    return false;
  return (
    localized(v.title, 200) &&
    localized(v.summary, 800) &&
    localized(v.problem) &&
    localized(v.solution) &&
    localized(v.nextSteps) &&
    choice(v.discipline, DISCIPLINES) &&
    choice(v.type, TYPES) &&
    choice(v.stage, STAGES) &&
    Number.isInteger(v.year) &&
    Number(v.year) >= 2000 &&
    Number(v.year) <= 2099 &&
    array(v.alsoDisciplines, (x) => choice(x, DISCIPLINES), 7) &&
    array(v.technologies, (x) => choice(x, TECHNOLOGIES), 14) &&
    object(v.technicalApproach, ["overview", "decisions"]) &&
    localized(v.technicalApproach.overview) &&
    array(v.technicalApproach.decisions, (x) => localized(x, 2000)) &&
    array(v.development, (x) => localized(x, 2000)) &&
    array(
      v.validation,
      (x) =>
        object(x, ["measure", "result"]) &&
        localized(x.measure, 1000) &&
        localized(x.result, 1000)
    ) &&
    object(v.collaboration, ["seeking", "application"]) &&
    localized(v.collaboration.seeking, 3000) &&
    localized(v.collaboration.application, 3000) &&
    array(
      v.parts,
      (x) =>
        object(x, ["name", "qty"]) &&
        localized(x.name, 200) &&
        Number.isInteger(x.qty) &&
        Number(x.qty) > 0 &&
        Number(x.qty) <= 10000
    ) &&
    array(
      v.achievements,
      (x) =>
        object(x, ["competition", "result", "year", "href", "sample"]) &&
        localized(x.competition, 300) &&
        choice(x.result, [
          "winner",
          "first",
          "second",
          "third",
          "finalist",
          "special",
          "participant",
        ]) &&
        Number.isInteger(x.year) &&
        Number(x.year) >= 2000 &&
        Number(x.year) <= 2099 &&
        x.sample === false &&
        (x.href === undefined || safeProjectLink(x.href))
    ) &&
    array(
      v.team,
      (x) =>
        object(x, ["name", "role", "memberId"]) &&
        localized(x.name, 200) &&
        localized(x.role, 200) &&
        (x.memberId === undefined ||
          (typeof x.memberId === "string" && UUID.test(x.memberId))),
      20
    ) &&
    array(
      v.links,
      (x) =>
        object(x, ["label", "href"]) &&
        localized(x.label, 200) &&
        safeProjectLink(x.href),
      10
    ) &&
    array(v.mediaIds, (x) => typeof x === "string" && UUID.test(x), 6) &&
    new Set(v.mediaIds as string[]).size === (v.mediaIds as string[]).length
  );
}
