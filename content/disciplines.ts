import type { Localized } from "@/lib/i18n";

/**
 * The seven disciplines defined in Draft 1's project content (src/components/sections/
 * disciplineData.ts). This is the society's own list, not an official SQU department list.
 */

export type DisciplineId =
  | "mechanical"
  | "electrical"
  | "civil"
  | "petroleum"
  | "chemical"
  | "mechatronics"
  | "industrial";

export interface Discipline {
  id: DisciplineId;
  name: Localized;
  shortName: Localized;
  focus: Localized;
  description: Localized;
}

export const DISCIPLINES: Discipline[] = [
  {
    id: "mechanical",
    name: { en: "Mechanical Engineering", ar: "الهندسة الميكانيكية" },
    shortName: { en: "Mechanical", ar: "الميكانيكية" },
    focus: { en: "Motion & mechanisms", ar: "الحركة والآليات" },
    description: {
      en: "Designing machines, mechanisms and systems that turn ideas into motion.",
      ar: "تصميم الآلات والآليات والأنظمة التي تحوّل الأفكار إلى حركة.",
    },
  },
  {
    id: "electrical",
    name: {
      en: "Electrical & Computer Engineering",
      ar: "الهندسة الكهربائية وهندسة الحاسوب",
    },
    shortName: { en: "Electrical & Computer", ar: "الكهربائية والحاسوب" },
    focus: { en: "Circuits & computation", ar: "الدوائر والحوسبة" },
    description: {
      en: "Connecting circuits, power and computation to make intelligent systems possible.",
      ar: "ربط الدوائر والطاقة والحوسبة لتصبح الأنظمة الذكية ممكنة.",
    },
  },
  {
    id: "civil",
    name: {
      en: "Civil & Architectural Engineering",
      ar: "الهندسة المدنية والمعمارية",
    },
    shortName: { en: "Civil & Architectural", ar: "المدنية والمعمارية" },
    focus: { en: "Structures & spaces", ar: "المنشآت والفضاءات" },
    description: {
      en: "Shaping resilient structures and thoughtful spaces for the world we share.",
      ar: "تشكيل منشآت متينة وفضاءات مدروسة للعالم الذي نتشاركه.",
    },
  },
  {
    id: "petroleum",
    name: { en: "Petroleum Engineering", ar: "هندسة النفط" },
    shortName: { en: "Petroleum", ar: "النفط" },
    focus: { en: "Energy & exploration", ar: "الطاقة والاستكشاف" },
    description: {
      en: "Engineering the responsible exploration and production of energy resources.",
      ar: "هندسة استكشاف موارد الطاقة وإنتاجها بمسؤولية.",
    },
  },
  {
    id: "chemical",
    name: { en: "Chemical Engineering", ar: "الهندسة الكيميائية" },
    shortName: { en: "Chemical", ar: "الكيميائية" },
    focus: { en: "Matter & transformation", ar: "المادة والتحوّل" },
    description: {
      en: "Transforming raw materials into useful products through carefully controlled processes.",
      ar: "تحويل المواد الخام إلى منتجات مفيدة عبر عمليات مضبوطة بعناية.",
    },
  },
  {
    id: "mechatronics",
    name: { en: "Mechatronics Engineering", ar: "هندسة الميكاترونكس" },
    shortName: { en: "Mechatronics", ar: "الميكاترونكس" },
    focus: { en: "Robotics & control", ar: "الروبوتات والتحكم" },
    description: {
      en: "Bringing mechanics, electronics and control together in responsive machines.",
      ar: "دمج الميكانيكا والإلكترونيات والتحكم في آلات سريعة الاستجابة.",
    },
  },
  {
    id: "industrial",
    name: { en: "Industrial Engineering", ar: "الهندسة الصناعية" },
    shortName: { en: "Industrial", ar: "الصناعية" },
    focus: { en: "Systems & production", ar: "الأنظمة والإنتاج" },
    description: {
      en: "Making production smarter by improving how people, materials and systems work together.",
      ar: "جعل الإنتاج أذكى بتحسين طريقة عمل الأفراد والمواد والأنظمة معًا.",
    },
  },
];

export const DISCIPLINE_BY_ID = Object.fromEntries(
  DISCIPLINES.map((d) => [d.id, d])
) as Record<DisciplineId, Discipline>;
