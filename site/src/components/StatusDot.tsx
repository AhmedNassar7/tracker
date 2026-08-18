// A colored dot beside the status text, not colored text or a colored
// pill background — per the dataviz skill's mark spec: "text never wears
// the data color... identity comes from the colored mark beside the
// text." Keeps this out of WCAG contrast trouble entirely (the funnel
// ramp's lighter steps wouldn't clear 4.5:1 as a text-on-fill pill) while
// still giving the "status-pill color morph" micro-interaction the plan
// asks for — the dot's background-color transitions when status changes.

import type { CSSProperties } from "react";
import { FUNNEL_RAMP, REJECTED_COLOR } from "../lib/chartColors";
import type { ApplicationStatus } from "../lib/tracker";

const FUNNEL_STAGES: ApplicationStatus[] = ["bookmarked", "applied", "oa", "interview", "offer"];

function colorFor(status: ApplicationStatus) {
  const idx = FUNNEL_STAGES.indexOf(status);
  return idx !== -1 ? FUNNEL_RAMP[idx] : REJECTED_COLOR;
}

type DotStyle = CSSProperties & { "--dot-light"?: string; "--dot-dark"?: string };

interface Props {
  status: ApplicationStatus;
}

export default function StatusDot({ status }: Props) {
  const color = colorFor(status);
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--dot-light)] transition-colors duration-300 dark:bg-[var(--dot-dark)]"
      style={{ "--dot-light": color.light, "--dot-dark": color.dark } as DotStyle}
    />
  );
}
