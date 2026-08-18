// Every hex below was run through the dataviz skill's validate_palette.js
// against this site's actual surfaces (white / slate-950), not eyeballed.
// See the two chart forms this site actually needs:
//
// - Funnel stage (bookmarked → applied → oa → interview → offer) is
//   ORDINAL — swapping the order would change its meaning — so it's a
//   single teal hue, monotone lightness, not the full categorical set.
//   Validated: `node validate_palette.js "<light-ramp>" --mode light
//   --surface "#ffffff" --ordinal` and the equivalent --mode dark run
//   against "#020617" (this site's dark surface). Both passed all checks.
// - Region/level/kind/source counts are each a SINGLE series (one count
//   per category) — per the color formula, one series takes one hue
//   throughout, never the 8-color categorical set (that's reserved for
//   multiple simultaneous series, which nothing on these dashboards has).

// index 0 = bookmarked … index 4 = offer. Light-mode ramp reads light→dark
// as a stage progresses (darker = further along, standard on a light
// surface); dark-mode ramp reads dark→light for the same reason inverted
// (lighter = more contrast = further along, once the surface itself is
// dark) — see palette.md's "flips anchor in dark".
export const FUNNEL_RAMP: { light: string; dark: string }[] = [
  { light: "#14b8a6", dark: "#134e4a" }, // bookmarked
  { light: "#0d9488", dark: "#0f766e" }, // applied
  { light: "#0f766e", dark: "#14b8a6" }, // oa
  { light: "#115e59", dark: "#2dd4bf" }, // interview
  { light: "#0a3d39", dark: "#5eead4" }, // offer
];

// "Rejected" isn't further along the funnel, it's a distinct terminal
// outcome — wears the fixed status-critical color instead of the ordinal
// ramp, same as the palette's own "status is fixed, never themed" rule.
export const REJECTED_COLOR = { light: "#d03b3b", dark: "#d03b3b" };

// Single-series magnitude bars (region/level/kind/source mix) — one hue,
// matching the site's existing teal accent so the dashboards read as part
// of the same product rather than a bolted-on chart library's defaults.
export const SINGLE_SERIES_COLOR = { light: "#0d9488", dark: "#2dd4bf" };
