import type { Localized } from "@/lib/i18n";

/**
 * The society overview, condensed from the text supplied for Draft 4. Facts only: student-run,
 * supported and supervised by the College of Engineering, established 2000–2001, an umbrella
 * body working with seven engineering societies, and its stated aims and activity types.
 */

export const OVERVIEW: {
  heading: Localized;
  paragraphs: Localized[];
  points: { id: string; title: Localized; body: Localized }[];
  /** Decorative backdrop: the society's own photograph, set in a blue atmosphere. */
  backdrop: { src: string; width: number; height: number };
} = {
  heading: {
    en: "A community built around engineering.",
    ar: "مجتمعٌ تجمعه الهندسة.",
  },
  paragraphs: [
    {
      en: "The Engineering Society is a student-run organisation at Sultan Qaboos University’s College of Engineering, working with the College’s support and supervision. Established in the 2000–2001 academic year, it is the umbrella body that works closely with the college’s seven engineering societies.",
      ar: "الجماعة الهندسية منظمة طلابية يديرها الطلاب في كلية الهندسة بجامعة السلطان قابوس، وتعمل بدعم الكلية وإشرافها. تأسست في العام الأكاديمي 2000/2001، وهي المظلة التي تعمل عن قرب مع الجمعيات الهندسية السبع في الكلية.",
    },
    {
      en: "Through seminars, conferences, exhibitions and workshops, it gives students room to learn, build 21st-century skills and share what they know, growing academically, socially and professionally. Its wider aim is to promote research, industrial collaboration and innovation in Oman, and to prepare people to contribute to their communities and the world.",
      ar: "ومن خلال الندوات والمؤتمرات والمعارض وورش العمل، تمنح الطلاب مساحة للتعلّم واكتساب مهارات القرن الحادي والعشرين وتبادل المعرفة، لينموا أكاديميًا واجتماعيًا ومهنيًا. وتسعى في نطاق أوسع إلى تعزيز البحث العلمي والتعاون مع القطاع الصناعي والابتكار في سلطنة عُمان، وإعداد كفاءات تسهم في خدمة مجتمعاتها والعالم.",
    },
  ],
  points: [
    {
      id: "student-led",
      title: { en: "Student-led", ar: "بقيادة طلابية" },
      body: {
        en: "Run by students, with the support and supervision of the College of Engineering.",
        ar: "يديرها الطلاب بدعم كلية الهندسة وإشرافها.",
      },
    },
    {
      id: "umbrella",
      title: { en: "One umbrella", ar: "مظلة واحدة" },
      body: {
        en: "Working closely with the college’s seven engineering societies.",
        ar: "تعمل عن قرب مع الجمعيات الهندسية السبع في الكلية.",
      },
    },
    {
      id: "practice",
      title: { en: "Learning in practice", ar: "تعلّم بالممارسة" },
      body: {
        en: "Seminars, conferences, exhibitions and workshops across the year.",
        ar: "ندوات ومؤتمرات ومعارض وورش عمل على مدار العام.",
      },
    },
    {
      id: "outward",
      title: { en: "Looking outward", ar: "آفاق أوسع" },
      body: {
        en: "Promoting research, industrial collaboration and innovation in Oman.",
        ar: "تعزيز البحث والتعاون الصناعي والابتكار في عُمان.",
      },
    },
  ],
  backdrop: { src: "/images/overview.jpg", width: 1170, height: 652 },
};
