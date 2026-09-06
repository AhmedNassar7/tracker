import { countryIso2, flagUrl } from "../lib/geo";

// A real flag image, not the flag emoji — Windows browsers render flag emoji
// as bare 2-letter codes ("CA" instead of 🇨🇦), so the emoji is useless for
// a cross-platform audience. flagcdn.com is free, keyless, tiny PNGs (same
// "external image, degrade gracefully" pattern as CompanyAvatar's favicons).
// Renders nothing when the country isn't in the ISO map.
export default function Flag({ country, className = "" }: { country?: string | null; className?: string }) {
  const iso2 = countryIso2(country);
  if (!iso2) return null;
  return (
    <img
      src={flagUrl(iso2)}
      srcSet={`${flagUrl(iso2, "40x30")} 2x`}
      width={20}
      height={15}
      loading="lazy"
      decoding="async"
      alt={country ?? ""}
      title={country ?? ""}
      className={`inline-block shrink-0 rounded-[2px] ${className}`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
