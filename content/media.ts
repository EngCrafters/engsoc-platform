import type { Localized } from "@/lib/i18n";

/** An authentic photograph supplied by the society. When present it replaces a drawing. */
export interface MediaImage {
  src: string;
  /** Describes what the photograph shows, in both languages. */
  alt: Localized;
  width: number;
  height: number;
  /** CSS object-position that keeps the subject in frame when the photo is cropped. */
  focus?: string;
}
