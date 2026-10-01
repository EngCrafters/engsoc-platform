import Image from "next/image";

const LOGO_PATH = "/brand/engineering-society-logo.png";

export function BrandMark({
  size = 40,
  alt = "",
}: {
  size?: number;
  alt?: string;
}) {
  return (
    <Image
      src={LOGO_PATH}
      alt={alt}
      width={size}
      height={size}
      className="shrink-0 object-contain"
    />
  );
}
