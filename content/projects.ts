import type { DisciplineId } from "./disciplines";
import type { DrawingId } from "@/components/marketing/drawings";
import type { Localized } from "@/lib/i18n";
import type { MediaImage } from "./media";

/**
 * SAMPLE CONTENT. The project and magazine archive is PRD Phase 3 (UC-05/UC-06) and has no
 * entries yet. These illustrative projects show how archived work will carry discipline,
 * year and team metadata. Team members are intentionally not named: public views never
 * expose personal details (PRD NFR-04). Every card is labelled "Sample".
 */

export interface ArchiveProject {
  id: string;
  sample: boolean;
  title: Localized;
  discipline: DisciplineId;
  year: string;
  /** Number of team members; the label ("Team of 5") is interface copy. */
  teamSize: number;
  summary: Localized;
  /** Link to a project detail page once the archive exists. */
  href: string | null;
  drawing: DrawingId;
  /** An authentic project photograph, when available; replaces the drawing. */
  image?: MediaImage;
}

export const PROJECTS: ArchiveProject[] = [
  {
    id: "line-following-rover",
    sample: true,
    title: {
      en: "Autonomous line-following rover",
      ar: "مركبة ذاتية لتتبّع الخطوط",
    },
    discipline: "mechatronics",
    year: "2025–26",
    teamSize: 5,
    summary: {
      en: "A competition rover that combines infrared sensing with PID steering, documented with wiring diagrams, code and test logs so next year’s team starts from a working baseline.",
      ar: "مركبة مسابقات تجمع بين الاستشعار بالأشعة تحت الحمراء والتوجيه بمتحكّم PID، وموثّقة بمخططات التوصيل والشيفرة وسجلات الاختبار ليبدأ فريق العام القادم من أساس يعمل.",
    },
    href: null,
    drawing: "rover",
  },
  {
    id: "water-quality-node",
    sample: true,
    title: {
      en: "Low-cost water-quality sensor node",
      ar: "وحدة استشعار منخفضة التكلفة لجودة المياه",
    },
    discipline: "electrical",
    year: "2025",
    teamSize: 3,
    summary: {
      en: "A solar-powered board that logs turbidity and temperature and reports readings over a low-power radio link.",
      ar: "لوحة تعمل بالطاقة الشمسية تسجّل العكارة ودرجة الحرارة، وترسل القراءات عبر وصلة لاسلكية منخفضة الاستهلاك.",
    },
    href: null,
    drawing: "sensor-node",
  },
  {
    id: "seismic-truss-model",
    sample: true,
    title: {
      en: "Seismic-resistant truss model",
      ar: "نموذج جملون مقاوم للزلازل",
    },
    discipline: "civil",
    year: "2024",
    teamSize: 6,
    summary: {
      en: "A scale truss tested on a shake table, comparing bracing layouts for stiffness against weight.",
      ar: "جملون مصغّر اختُبر على طاولة اهتزاز لمقارنة أنماط التدعيم من حيث الصلابة مقابل الوزن.",
    },
    href: null,
    drawing: "truss",
  },
  {
    id: "shelter-cooling-study",
    sample: true,
    title: {
      en: "Passive cooling study for campus shelters",
      ar: "دراسة التبريد السلبي لمظلات الحرم الجامعي",
    },
    discipline: "mechanical",
    year: "2025",
    teamSize: 4,
    summary: {
      en: "Measured shade, airflow and surface temperatures to propose a lower-energy shelter design.",
      ar: "قياس الظل وحركة الهواء ودرجات حرارة الأسطح لاقتراح تصميم مظلة أقل استهلاكًا للطاقة.",
    },
    href: null,
    drawing: "shelter",
  },
  {
    id: "produced-water-bench",
    sample: true,
    title: {
      en: "Produced-water treatment bench model",
      ar: "نموذج مخبري لمعالجة المياه المصاحبة",
    },
    discipline: "chemical",
    year: "2024",
    teamSize: 4,
    summary: {
      en: "A bench-scale separation process that estimates how much oilfield water could be treated for reuse.",
      ar: "عملية فصل على نطاق مخبري تقدّر كمية مياه الحقول النفطية التي يمكن معالجتها لإعادة استخدامها.",
    },
    href: null,
    drawing: "water-bench",
  },
];
