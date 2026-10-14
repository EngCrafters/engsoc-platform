/**
 * Arabic has six plural forms; the noun changes with the number (مشروع واحد، مشروعان،
 * ٣ مشاريع، ١١ مشروعًا). Each form is a small function so the number can sit where the
 * grammar puts it.
 */
type ArabicForms = {
  zero?: (n: string) => string;
  one: (n: string) => string;
  two: (n: string) => string;
  few: (n: string) => string;
  many: (n: string) => string;
  other: (n: string) => string;
};

const arRules = new Intl.PluralRules("ar");

export function pluralAr(n: number, forms: ArabicForms) {
  const category = arRules.select(n) as keyof ArabicForms;
  const form = forms[category] ?? forms.other;
  return form(String(n));
}

export function pluralEn(n: number, one: string, other: string) {
  return `${n} ${n === 1 ? one : other}`;
}
