import type { ReactNode } from "react";

/**
 * Subject-specific technical drawings for event and project imagery, on a 480 × 300 sheet.
 * They stand in until the society supplies photographs (see `image` in content/*), and are
 * drawn in one language: navy line work, white-filled parts, cobalt construction lines, and a
 * single gold detail marking what matters in each subject. Key content stays within
 * x 60–420 / y 40–260 so any crop (16:9 → 4:3) keeps it.
 *
 * Classes: l = part outline · f = filled part · c = construction · a = flow/motion
 *          d = dimension · h = hatch · g = gold detail · r = gold callout ring
 */

export type DrawingId =
  | "robotics-workshop"
  | "careers-panel"
  | "site-visit"
  | "rover"
  | "sensor-node"
  | "truss"
  | "shelter"
  | "water-bench";

function Callout({ x, y }: { x: number; y: number }) {
  return (
    <>
      <circle cx={x} cy={y} r="15" className="r" />
      <circle cx={x} cy={y} r="4.5" className="g" />
    </>
  );
}

function Ticks({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <path
      d={`M${x1} ${y}H${x2}M${x1} ${y - 6}v12M${x2} ${y - 6}v12`}
      className="d"
    />
  );
}

function Hatch({
  x1,
  x2,
  y,
  step = 12,
}: {
  x1: number;
  x2: number;
  y: number;
  step?: number;
}) {
  let d = "";
  for (let x = x1; x < x2; x += step) d += `M${x} ${y + 10}l10 -10`;
  return <path d={d} className="h" />;
}

const roboticsWorkshop = (
  <>
    <path d="M60 236H420" className="l" />
    <Hatch x1={60} x2={420} y={236} step={16} />
    {/* Arm */}
    <rect x="118" y="208" width="74" height="28" rx="4" className="f" />
    <rect
      x="-8"
      y="-9"
      width="124"
      height="18"
      rx="9"
      transform="translate(155 198) rotate(-46)"
      className="f"
    />
    <rect
      x="-7"
      y="-7"
      width="106"
      height="14"
      rx="7"
      transform="translate(231 121) rotate(11)"
      className="f"
    />
    <circle cx="155" cy="198" r="13" className="f" />
    <circle cx="155" cy="198" r="4" className="l" />
    <circle cx="231" cy="121" r="10" className="f" />
    <circle cx="320" cy="139" r="7" className="f" />
    <path d="M326 133l18 -9l6 6M326 145l18 9l6 -6" className="l" />
    {/* Joint travel */}
    <path d="M250 96a32 32 0 0 1 14 44" className="c" />
    <path d="M128 168a38 38 0 0 1 52 -6" className="c" />
    {/* Microcontroller and lead */}
    <rect x="352" y="204" width="60" height="32" rx="3" className="f" />
    <rect x="369" y="211" width="26" height="18" rx="2" className="l" />
    <path
      d="M373 211v-5M380 211v-5M387 211v-5M373 229v5M380 229v5M387 229v5"
      className="l"
    />
    <path d="M352 224C312 252 236 254 192 226" className="c" />
    <Ticks x1={118} x2={192} y={256} />
    <Callout x={231} y={121} />
  </>
);

const careersPanel = (
  <>
    {/* Stage, panel table and chairs (plan view) */}
    <rect x="140" y="44" width="200" height="62" rx="5" className="f" />
    <rect x="178" y="76" width="124" height="16" rx="3" className="l" />
    {[196, 227, 258, 289].map((x) => (
      <circle key={x} cx={x} cy="64" r="8" className="l" />
    ))}
    <rect x="318" y="72" width="14" height="18" rx="2" className="l" />
    {/* Audience rows */}
    {[128, 154, 180, 206].map((r) => (
      <path
        key={r}
        d={`M${240 - r * 0.86} ${40 + r * 0.5}A${r} ${r} 0 0 0 ${240 + r * 0.86} ${40 + r * 0.5}`}
        className="l seats"
      />
    ))}
    <path d="M240 108V262" className="c" />
    {/* Sightline from one seat to the panel */}
    <path d="M204 191L240 92" className="c" />
    <Callout x={204} y={191} />
  </>
);

const siteVisit = (
  <>
    <path d="M40 230H440" className="l" />
    <Hatch x1={40} x2={440} y={230} step={16} />
    {/* Piles */}
    <path
      d="M130 230v34M240 230v34M350 230v34M122 264h16M232 264h16M342 264h16"
      className="l"
    />
    {/* Frame */}
    <rect x="126" y="86" width="228" height="6" className="f" />
    <rect x="126" y="134" width="228" height="6" className="f" />
    <rect x="126" y="182" width="228" height="6" className="f" />
    <path d="M130 92V230M240 92V230M350 92V230" className="l" />
    {/* Shading louvres */}
    <path
      d="M354 102l18 -8M354 118l18 -8M354 150l18 -8M354 166l18 -8M354 198l18 -8M354 214l18 -8"
      className="l"
    />
    {/* Roof photovoltaics */}
    <path
      d="M148 86l36 -14M196 86l36 -14M244 86l36 -14M292 86l36 -14"
      className="l"
    />
    {/* Tower crane */}
    <path
      d="M70 230V52M82 230V52M70 210l12 -18M70 174l12 -18M70 138l12 -18M70 102l12 -18M70 66l12 -12"
      className="l"
    />
    <path d="M44 52H206M76 52l-18 -16H96z" className="l" />
    <path d="M112 52v42" className="l" />
    <rect x="102" y="94" width="20" height="14" rx="2" className="f" />
    {/* Visitor route */}
    <path d="M60 244H420" className="c" />
    <path d="M412 238l8 6l-8 6" className="a" />
    <Callout x={240} y={244} />
  </>
);

const rover = (
  <>
    <path d="M50 232H430" className="l" />
    <path d="M250 232H330" className="tape" />
    <rect x="130" y="132" width="200" height="52" rx="10" className="f" />
    <rect x="160" y="112" width="120" height="20" rx="4" className="f" />
    <path d="M190 112V78" className="l" />
    <circle cx="190" cy="74" r="5" className="l" />
    <circle cx="175" cy="200" r="32" className="f" />
    <circle cx="175" cy="200" r="8" className="l" />
    <circle cx="290" cy="200" r="32" className="f" />
    <circle cx="290" cy="200" r="8" className="l" />
    {/* Infrared sensor bar and its beams */}
    <rect x="328" y="174" width="44" height="12" rx="3" className="f" />
    <path d="M340 186L336 230M350 186V230M360 186L364 230" className="c" />
    <Ticks x1={175} x2={290} y={256} />
    <Callout x={350} y={180} />
  </>
);

const sensorNode = (
  <>
    {/* Solar cell and lead */}
    <rect x="60" y="56" width="72" height="46" rx="3" className="f" />
    <path d="M84 56v46M108 56v46M60 79h72" className="l" />
    <path d="M132 80C150 80 146 104 162 104" className="c" />
    {/* Board */}
    <rect x="150" y="70" width="190" height="150" rx="8" className="f" />
    {[
      [162, 82],
      [328, 82],
      [162, 208],
      [328, 208],
    ].map(([x, y]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" className="l" />
    ))}
    <rect x="198" y="116" width="54" height="54" rx="3" className="l" />
    <path
      d="M206 116v-6M216 116v-6M226 116v-6M236 116v-6M246 116v-6M206 170v6M216 170v6M226 170v6M236 170v6M246 170v6M198 124h-6M198 134h-6M198 144h-6M198 154h-6M198 164h-6"
      className="l"
    />
    {/* Radio module and antenna */}
    <rect x="272" y="94" width="48" height="32" rx="3" className="l" />
    <path d="M296 94V62h10v10h10V62h10v10" className="l" />
    {/* Traces, drawn in the logo's 45° language */}
    <path
      d="M252 132h8l12 -12M252 150h24l20 -20v-4M236 176v14l14 14h40"
      className="l"
    />
    {/* Water probe */}
    <path d="M172 220C172 250 126 238 118 250" className="c" />
    <rect x="98" y="236" width="22" height="40" rx="11" className="f" />
    <Callout x={109} y={266} />
  </>
);

const truss = (
  <>
    <path d="M60 250H420" className="l" />
    <rect x="80" y="218" width="320" height="14" rx="3" className="f" />
    <circle cx="112" cy="241" r="6" className="l" />
    <circle cx="368" cy="241" r="6" className="l" />
    <path d="M98 218L110 204L122 218ZM358 218L370 204L382 218Z" className="l" />
    {/* Pratt truss */}
    <path
      d="M110 204H370M140 130H340M110 204L140 130M370 204L340 130M140 130V204M190 130V204M240 130V204M290 130V204M340 130V204M140 130L190 204M190 130L240 204M340 130L290 204M290 130L240 204"
      className="l"
    />
    {[140, 190, 240, 290, 340].map((x) => (
      <circle key={x} cx={x} cy="130" r="3.5" className="f" />
    ))}
    <rect x="222" y="106" width="36" height="24" rx="2" className="f" />
    {/* Sway under shaking */}
    <path d="M110 204L152 130H352L370 204" className="c" />
    <path d="M160 266H320M168 260l-8 6l8 6M312 260l8 6l-8 6" className="a" />
    <Callout x={240} y={118} />
  </>
);

const shelter = (
  <>
    <path d="M50 238H430" className="l" />
    <Hatch x1={50} x2={430} y={238} step={16} />
    <path d="M150 238V124M330 238V120" className="l" />
    <path d="M104 132Q240 82 376 118" className="l" />
    <path d="M104 142Q240 92 376 128" className="l" />
    {/* Perforated west screen */}
    <path d="M112 146V226M120 146V226M128 146V226M136 146V226" className="l" />
    {/* Bench */}
    <rect x="206" y="204" width="76" height="8" rx="2" className="f" />
    <path d="M214 212v26M274 212v26" className="l" />
    {/* Sun angle and air path */}
    <circle cx="410" cy="52" r="13" className="l" />
    <path d="M398 62L300 238" className="c" />
    <path d="M60 176C140 156 200 196 282 172S382 154 432 166" className="a" />
    <path d="M424 160l8 6l-9 4" className="a" />
    {/* Surface temperature sensor */}
    <Callout x={330} y={180} />
  </>
);

const waterBench = (
  <>
    <path d="M50 232H440" className="l" />
    {/* Feed tank */}
    <rect x="60" y="104" width="62" height="100" rx="6" className="f" />
    <path d="M60 138H122M60 126H122" className="c" />
    {/* Pump */}
    <path d="M122 190H146" className="l" />
    <circle cx="160" cy="190" r="14" className="f" />
    <path d="M154 182l14 8l-14 8z" className="l" />
    <path d="M174 190H188V124H200" className="l" />
    {/* Separator vessel */}
    <rect x="200" y="100" width="112" height="48" rx="24" className="f" />
    <path d="M272 110V140" className="l" />
    <path d="M282 100V76H296" className="l" />
    {/* Filter column */}
    <path d="M300 148V166H330" className="l" />
    <rect x="330" y="94" width="36" height="112" rx="6" className="f" />
    <Hatch x1={334} x2={360} y={120} step={9} />
    <Hatch x1={334} x2={360} y={146} step={9} />
    <Hatch x1={334} x2={360} y={172} step={9} />
    {/* Clean-water tank */}
    <path d="M366 190H390" className="l" />
    <rect x="390" y="152" width="44" height="60" rx="5" className="f" />
    <path d="M390 172H434" className="c" />
    {/* Flow and valves */}
    <path
      d="M132 186l6 4l-6 4M318 162l6 4l-6 4M378 186l6 4l-6 4"
      className="a"
    />
    <path d="M182 150l12 10v-10l-12 10z" className="l" />
    <Callout x={272} y={124} />
  </>
);

export const DRAWINGS: Record<DrawingId, ReactNode> = {
  "robotics-workshop": roboticsWorkshop,
  "careers-panel": careersPanel,
  "site-visit": siteVisit,
  rover,
  "sensor-node": sensorNode,
  truss,
  shelter,
  "water-bench": waterBench,
};
