import type { Localized } from "@/lib/i18n";
import type { MediaImage } from "./media";

/**
 * The society's six activities. Each one is shown on the homepage as an automatic slideshow
 * of its previous events (components/sections/ActivityGalleries.tsx). Dated, upcoming events
 * live in content/events.ts.
 *
 * EDITORIAL STATUS
 * - `nameAr` / `nameEn` are the society's official names for each activity.
 * - `description`: as supplied by the society. أستوديو الخريجين's description is still to come.
 * - `events`: previous events, newest or most notable first. None have been supplied yet, so
 *   every event is DEMONSTRATION content (`demo: true`): titles, dates and attendance are
 *   samples, each tagged "Demo" on the page. The photographs are the society's own; each
 *   activity opens on its own photograph, and the society's other photographs repeat after it.
 *
 * To add a real event: put it in its activity's `events` (any number; two or more slide), with
 * its date as 'YYYY-MM-DD', its attendance, an authentic photograph, and no `demo` flag.
 */

export type ActivityId =
  | "gathering"
  | "programme"
  | "graduate-workshops"
  | "graduate-studio"
  | "evenings"
  | "competitions";

export interface GalleryEvent {
  id: string;
  title: Localized;
  /** 'YYYY-MM-DD'. Shown as month and year. */
  date: string;
  attendance: { count: number; kind: "attendees" | "visitors" };
  image: MediaImage;
  demo?: boolean;
}

export interface Activity {
  id: ActivityId;
  nameAr: string;
  nameEn: string;
  description: Localized;
  descriptionStatus: "confirmed" | "needs-input";
  events: GalleryEvent[];
}

/** The society's own photographs (resized copies of the files at the project root). */
const PHOTO = {
  gathering: {
    src: "/images/activities/gathering.jpg",
    width: 1170,
    height: 762,
  },
  programme: {
    src: "/images/activities/programme.jpg",
    width: 2400,
    height: 1600,
  },
  workshops: {
    src: "/images/activities/graduate-workshops.jpg",
    width: 1600,
    height: 2400,
  },
  studio: {
    src: "/images/activities/graduate-studio.jpg",
    width: 2400,
    height: 1600,
  },
  evenings: {
    src: "/images/activities/evenings.jpg",
    width: 1170,
    height: 652,
  },
  competitions: {
    src: "/images/activities/competitions.jpg",
    width: 2400,
    height: 1603,
  },
} as const;

const ALT = {
  gathering: {
    en: "An exhibition hall: visitors walk between lit display panels around a glowing geometric sculpture.",
    ar: "قاعة معرض: زوّار يتجولون بين لوحات عرض مضيئة حول مجسّم هندسي متوهّج.",
  },
  programme: {
    en: "A student presents “Reservoir Simulation Modelling” to classmates seated in a lecture room.",
    ar: "طالب يقدّم عرضًا بعنوان «نمذجة محاكاة المكامن» أمام زملائه في قاعة محاضرات.",
  },
  workshops: {
    en: "Students working at computers in a lab; in the foreground, one models a 3D shape on a laptop.",
    ar: "طلاب يعملون على الحواسيب في مختبر، وفي المقدمة طالب يصمّم مجسّمًا ثلاثي الأبعاد على حاسوبه المحمول.",
  },
  studio: {
    en: "A graduate in a bisht poses in a decorated photo corner, his reflection caught in a standing mirror.",
    ar: "خرّيج يرتدي البشت في ركن تصوير مزيّن، وتنعكس صورته في مرآة قائمة.",
  },
  evenings: {
    en: "A speaker stands on stage facing an audience holding up phone lights in a darkened hall.",
    ar: "متحدّث يقف على المسرح أمام جمهور يرفع أضواء هواتفه في قاعة معتمة.",
  },
  competitions: {
    en: "Two students inspect entries laid out on a display table in a large auditorium.",
    ar: "طالبان يتفقّدان أعمالًا معروضة على طاولة في قاعة كبيرة.",
  },
} as const;

/** A society photograph with its description and a crop that suits the slide. */
const photo = (key: keyof typeof PHOTO, focus?: string): MediaImage => ({
  ...PHOTO[key],
  alt: ALT[key],
  focus,
});

export const ACTIVITIES: Activity[] = [
  {
    id: "gathering",
    nameAr: "التجمع الهندسي",
    nameEn: "Engineering Gathering",
    description: {
      en: "A gathering that brings students from across the engineering disciplines together in one place.",
      ar: "تجمّع يلتقي فيه طلاب التخصصات الهندسية المختلفة في مكان واحد.",
    },
    descriptionStatus: "confirmed",
    events: [
      {
        id: "gathering-2025",
        demo: true,
        title: { en: "Engineering Gathering 2025", ar: "التجمع الهندسي 2025" },
        date: "2025-01-20",
        attendance: { count: 3200, kind: "visitors" },
        image: photo("gathering", "50% 40%"),
      },
      {
        id: "disciplines-open-day",
        demo: true,
        title: {
          en: "Disciplines Open Day",
          ar: "اليوم المفتوح للتخصصات الهندسية",
        },
        date: "2024-10-15",
        attendance: { count: 1400, kind: "visitors" },
        image: photo("competitions", "50% 25%"),
      },
      {
        id: "industry-meetup",
        demo: true,
        title: { en: "Industry Meet-up", ar: "لقاء القطاع الصناعي" },
        date: "2025-03-11",
        attendance: { count: 950, kind: "attendees" },
        image: photo("evenings", "30% 50%"),
      },
    ],
  },
  {
    id: "programme",
    nameAr: "البرنامج الهندسي",
    nameEn: "Engineering Programme",
    description: {
      en: "A structured programme of engineering activities for students across the college.",
      ar: "برنامج منظّم من الأنشطة الهندسية لطلاب الكلية من مختلف التخصصات.",
    },
    descriptionStatus: "confirmed",
    events: [
      {
        id: "reservoir-simulation",
        demo: true,
        title: {
          en: "Reservoir Simulation Modelling",
          ar: "نمذجة محاكاة المكامن",
        },
        date: "2025-02-18",
        attendance: { count: 85, kind: "attendees" },
        image: photo("programme", "62% 45%"),
      },
      {
        id: "design-fundamentals",
        demo: true,
        title: {
          en: "Engineering Design Fundamentals",
          ar: "أساسيات التصميم الهندسي",
        },
        date: "2024-11-05",
        attendance: { count: 120, kind: "attendees" },
        image: photo("workshops", "50% 62%"),
      },
      {
        id: "presentation-skills",
        demo: true,
        title: {
          en: "Technical Presentation Skills",
          ar: "مهارات العرض التقني",
        },
        date: "2025-04-02",
        attendance: { count: 70, kind: "attendees" },
        image: photo("programme", "25% 70%"),
      },
    ],
  },
  {
    id: "graduate-workshops",
    nameAr: "ورش الخريجين",
    nameEn: "Graduate Workshops",
    description: {
      en: "Workshops that connect current students with the society’s graduates.",
      ar: "ورش عمل تصل الطلاب الحاليين بخريجي الجماعة.",
    },
    descriptionStatus: "confirmed",
    events: [
      {
        id: "3d-modelling",
        demo: true,
        title: {
          en: "3D Modelling Workshop",
          ar: "ورشة النمذجة ثلاثية الأبعاد",
        },
        date: "2025-02-04",
        attendance: { count: 40, kind: "attendees" },
        image: photo("workshops", "50% 88%"),
      },
      {
        id: "campus-to-career",
        demo: true,
        title: { en: "From Campus to Career", ar: "من الجامعة إلى سوق العمل" },
        date: "2024-12-10",
        attendance: { count: 65, kind: "attendees" },
        image: photo("programme", "45% 60%"),
      },
      {
        id: "report-writing",
        demo: true,
        title: { en: "Technical Report Writing", ar: "كتابة التقارير الفنية" },
        date: "2025-03-18",
        attendance: { count: 45, kind: "attendees" },
        image: photo("workshops", "50% 55%"),
      },
    ],
  },
  {
    id: "graduate-studio",
    nameAr: "أستوديو الخريجين",
    nameEn: "Graduate Studio",
    // Needs the society's own description: the name alone does not say what the programme does.
    description: {
      en: "A description of this programme will be added by the society.",
      ar: "ستضيف الجماعة وصفًا لهذا البرنامج.",
    },
    descriptionStatus: "needs-input",
    events: [
      {
        id: "graduates-corner",
        demo: true,
        title: { en: "Graduates’ Corner", ar: "ركن الخريجين" },
        date: "2025-04-28",
        attendance: { count: 780, kind: "visitors" },
        image: photo("studio", "62% 40%"),
      },
      {
        id: "graduation-portraits",
        demo: true,
        title: { en: "Graduation Portraits", ar: "جلسة صور الخريجين" },
        date: "2024-12-17",
        attendance: { count: 260, kind: "attendees" },
        image: photo("studio", "20% 60%"),
      },
      {
        id: "graduation-projects",
        demo: true,
        title: {
          en: "Graduation Projects Studio",
          ar: "أستوديو مشاريع التخرج",
        },
        date: "2025-05-06",
        attendance: { count: 90, kind: "attendees" },
        image: photo("gathering", "70% 70%"),
      },
    ],
  },
  {
    id: "evenings",
    nameAr: "الأمسيات",
    nameEn: "Evenings",
    description: {
      en: "Evening sessions that bring the society’s members together.",
      ar: "أمسيات تجمع أعضاء الجماعة.",
    },
    descriptionStatus: "confirmed",
    events: [
      {
        id: "leadership-evening",
        demo: true,
        title: {
          en: "Engineering Leadership Evening",
          ar: "أمسية القيادة الهندسية",
        },
        date: "2024-11-12",
        attendance: { count: 420, kind: "attendees" },
        image: photo("evenings", "50% 30%"),
      },
      {
        id: "ramadan-evening",
        demo: true,
        title: { en: "Ramadan Evening", ar: "الأمسية الرمضانية" },
        date: "2025-03-15",
        attendance: { count: 300, kind: "attendees" },
        image: photo("gathering", "50% 30%"),
      },
      {
        id: "innovation-evening",
        demo: true,
        title: { en: "Innovation Talks Evening", ar: "أمسية حوارات الابتكار" },
        date: "2025-05-20",
        attendance: { count: 260, kind: "attendees" },
        image: photo("evenings", "70% 60%"),
      },
    ],
  },
  {
    id: "competitions",
    nameAr: "المسابقات",
    nameEn: "Competitions",
    description: {
      en: "Competitions that invite students to put their engineering skills to the test.",
      ar: "مسابقات تدعو الطلاب إلى اختبار مهاراتهم الهندسية.",
    },
    descriptionStatus: "confirmed",
    events: [
      {
        id: "projects-challenge",
        demo: true,
        title: { en: "Student Projects Challenge", ar: "تحدي مشاريع الطلبة" },
        date: "2024-10-22",
        attendance: { count: 180, kind: "attendees" },
        image: photo("competitions", "55% 60%"),
      },
      {
        id: "robotics-challenge",
        demo: true,
        title: { en: "Robotics Challenge", ar: "تحدي الروبوتات" },
        date: "2025-02-25",
        attendance: { count: 220, kind: "attendees" },
        image: photo("workshops", "50% 80%"),
      },
      {
        id: "innovation-pitch",
        demo: true,
        title: {
          en: "Innovation Pitch Contest",
          ar: "مسابقة الأفكار الابتكارية",
        },
        date: "2025-04-15",
        attendance: { count: 310, kind: "attendees" },
        image: photo("programme", "60% 45%"),
      },
    ],
  },
];

export const ACTIVITY_BY_ID = Object.fromEntries(
  ACTIVITIES.map((a) => [a.id, a])
) as Record<ActivityId, Activity>;

/**
 * Previous editions of these programmes, for the /activities archive. Add one record per
 * edition as it is documented; the archive's programme and year filters come from this data.
 */
export interface ActivityEdition {
  id: string;
  activity: ActivityId;
  title: Localized;
  year: number;
  summary?: Localized;
  image?: MediaImage;
  href?: string;
}

export const ACTIVITY_EDITIONS: ActivityEdition[] = [];
