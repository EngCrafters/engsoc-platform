import type { Localized } from "@/lib/i18n";
import type { MediaImage } from "./media";

/**
 * The society's organisation, as structured data. Both the homepage leadership tree and the
 * About page chart render from here; nothing is positioned by hand.
 *
 * ROSTER STATUS: no names, portraits, responsibilities or term have been supplied. Every
 * position is therefore vacant (`holder: null`) and renders as an intentional placeholder.
 * Fill in `holder` (and optionally `responsibility`) as the society confirms its roster.
 *
 * HIERARCHY NOTES
 * - Senior leadership is one President and three Vice Presidents (the homepage requirement).
 * - The supplied brief listed فريق التصوير twice. It appears once here, under اللجنة الإعلامية,
 *   until the society confirms whether a second team was intended and where it belongs.
 * - Committee chairs and deputies are added to `roles` only when the actual roster specifies
 *   them. No committee is assumed to have a particular number of deputies.
 * - Arabic names (`name.ar`) are the society's own; English names are working labels.
 */

export interface Person {
  name: Localized;
  portrait: MediaImage | null;
  /** CSS object-position for consistent head-and-shoulders crops, e.g. '50% 28%'. */
  portraitFocus?: string;
}

export interface Position {
  id: string;
  title: Localized;
  holder: Person | null;
  /** Optional subtitle, shown only when supplied. */
  responsibility?: Localized | null;
}

export interface Team {
  id: string;
  name: Localized;
}

export interface CommitteeRole {
  title: Localized;
  holder: Person | null;
}

export interface Committee {
  id: string;
  name: Localized;
  roles: CommitteeRole[];
  teams: Team[];
}

export const SENIOR_LEADERSHIP: Localized = {
  en: "Senior leadership",
  ar: "الإدارة العليا",
};

const PRESIDENT: Localized = { en: "President", ar: "الرئيس" };
const VICE_PRESIDENT: Localized = { en: "Vice President", ar: "نائب الرئيس" };

export const LEADERSHIP: {
  /** e.g. { en: '2026–27 academic year', ar: 'العام الأكاديمي 2026–2027' }. Hidden while null. */
  term: Localized | null;
  president: Position;
  vicePresidents: Position[];
} = {
  term: null,
  president: { id: "president", title: PRESIDENT, holder: null },
  vicePresidents: [
    { id: "vice-president-1", title: VICE_PRESIDENT, holder: null },
    { id: "vice-president-2", title: VICE_PRESIDENT, holder: null },
    { id: "vice-president-3", title: VICE_PRESIDENT, holder: null },
  ],
};

export const COMMITTEES: Committee[] = [
  {
    id: "finance",
    name: { ar: "اللجنة المالية", en: "Finance Committee" },
    roles: [],
    teams: [],
  },
  {
    id: "media",
    name: { ar: "اللجنة الإعلامية", en: "Media Committee" },
    roles: [],
    teams: [
      {
        id: "photography",
        name: { ar: "فريق التصوير", en: "Photography Team" },
      },
      { id: "marketing", name: { ar: "فريق التسويق", en: "Marketing Team" } },
    ],
  },
  {
    id: "support",
    name: { ar: "لجنة الدعم والإسناد", en: "Support Committee" },
    roles: [],
    teams: [
      { id: "technical", name: { ar: "الفريق التقني", en: "Technical Team" } },
    ],
  },
  {
    id: "relations",
    name: { ar: "لجنة العلاقات", en: "Relations Committee" },
    roles: [],
    teams: [
      {
        id: "external-relations",
        name: { ar: "فريق العلاقات الخارجية", en: "External Relations Team" },
      },
      {
        id: "public-relations",
        name: { ar: "فريق العلاقات العامة", en: "Public Relations Team" },
      },
    ],
  },
  {
    id: "members-graduates",
    name: {
      ar: "لجنة شؤون الأعضاء والخريجين",
      en: "Members & Graduates Committee",
    },
    roles: [],
    teams: [],
  },
  {
    id: "activities",
    name: { ar: "لجنة الأنشطة", en: "Activities Committee" },
    roles: [],
    teams: [],
  },
  {
    id: "projects",
    name: { ar: "لجنة المشاريع", en: "Projects Committee" },
    roles: [],
    teams: [],
  },
  {
    id: "exhibition",
    name: { ar: "لجنة المعرض", en: "Exhibition Committee" },
    roles: [],
    teams: [],
  },
];
