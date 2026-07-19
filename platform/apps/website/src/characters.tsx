import { useId, type CSSProperties } from "react";

export type ZazooSpecies =
  | "owl"
  | "fox"
  | "elephant"
  | "beaver"
  | "swan"
  | "dolphin"
  | "dog"
  | "bear";
export type ZazooPose =
  | "working"
  | "reading"
  | "carrying"
  | "building"
  | "presenting"
  | "walking"
  | "resting"
  | "sleeping"
  | "celebrating";

interface ZazooCharacterProps {
  species: ZazooSpecies;
  pose?: ZazooPose;
  accent?: string;
  className?: string;
  style?: CSSProperties;
  labelled?: boolean;
}

const bodyColors: Record<ZazooSpecies, { base: string; light: string; dark: string; blush: string }> = {
  owl: { base: "#D8B995", light: "#F3E4CC", dark: "#9E795A", blush: "#D99A86" },
  fox: { base: "#C97A4B", light: "#F5D8B9", dark: "#8D4E31", blush: "#D98D78" },
  elephant: { base: "#AEB7BF", light: "#DDE2E5", dark: "#77828C", blush: "#C99A9B" },
  beaver: { base: "#9C694C", light: "#D9B89B", dark: "#6E4533", blush: "#CC8F7B" },
  swan: { base: "#E8E4DB", light: "#FFFDF7", dark: "#A6A39D", blush: "#DDA39E" },
  dolphin: { base: "#75AFC2", light: "#C9E2E8", dark: "#477F94", blush: "#D69C9D" },
  dog: { base: "#C7A47F", light: "#F0D9BC", dark: "#795A43", blush: "#D89A86" },
  bear: { base: "#92705A", light: "#D2B69E", dark: "#604839", blush: "#C98F7C" },
};

function SpeciesDetails({ species, fill, dark }: { species: ZazooSpecies; fill: string; dark: string }) {
  switch (species) {
    case "owl":
      return (
        <>
          <path className="zazoo__ear zazoo__ear--left" d="M38 56 53 24l20 30Z" fill={dark} />
          <path className="zazoo__ear zazoo__ear--right" d="m107 54 20-30 15 32Z" fill={dark} />
          <path d="M47 80c7-28 53-37 66 0-14-9-24-8-33 2-9-10-20-11-33-2Z" fill="#F5E7D1" opacity=".9" />
          <path d="M38 101c-17 12-18 36-5 46 5-14 11-24 22-31Z" fill={dark} className="zazoo__wing zazoo__wing--left" />
          <path d="M142 101c17 12 18 36 5 46-5-14-11-24-22-31Z" fill={dark} className="zazoo__wing zazoo__wing--right" />
        </>
      );
    case "fox":
      return (
        <>
          <path className="zazoo__ear zazoo__ear--left" d="M35 65 45 24l31 31Z" fill={dark} />
          <path className="zazoo__ear zazoo__ear--right" d="m104 55 31-31 10 41Z" fill={dark} />
          <path d="M57 77c13 12 33 12 46 0l-8 36H65Z" fill="#F5D8B9" opacity=".9" />
          <path className="zazoo__tail" d="M136 145c30-5 35 28 9 36 11-13 4-20-11-17Z" fill={fill} />
          <path d="M151 158c8 3 9 10 2 16-4-5-8-8-14-8Z" fill="#F5D8B9" />
        </>
      );
    case "elephant":
      return (
        <>
          <ellipse className="zazoo__ear zazoo__ear--left" cx="45" cy="82" rx="28" ry="35" fill={dark} />
          <ellipse className="zazoo__ear zazoo__ear--right" cx="135" cy="82" rx="28" ry="35" fill={dark} />
          <path className="zazoo__trunk" d="M82 96c1 27-4 41 8 46 12-5 7-19 8-46Z" fill={fill} stroke={dark} strokeWidth="2" />
        </>
      );
    case "beaver":
      return (
        <>
          <circle className="zazoo__ear zazoo__ear--left" cx="52" cy="54" r="15" fill={dark} />
          <circle className="zazoo__ear zazoo__ear--right" cx="128" cy="54" r="15" fill={dark} />
          <path className="zazoo__tail" d="M138 137c31 1 36 29 7 43-1-17-5-29-16-35Z" fill={dark} />
          <rect x="82" y="111" width="8" height="12" rx="2" fill="#FFFDF7" />
          <rect x="91" y="111" width="8" height="12" rx="2" fill="#FFFDF7" />
        </>
      );
    case "swan":
      return (
        <>
          <path d="M67 111c-7-28-3-54 16-64 13-7 27-2 30 8-18-4-27 9-20 26 7 18 6 27-2 38Z" fill={fill} stroke={dark} strokeWidth="2" />
          <path d="m108 57 19 6-18 8Z" fill="#C4955A" />
          <path className="zazoo__wing zazoo__wing--left" d="M36 116c-16 16-10 35 8 39 0-14 6-25 17-32Z" fill={dark} />
          <path className="zazoo__wing zazoo__wing--right" d="M144 116c16 16 10 35-8 39 0-14-6-25-17-32Z" fill={dark} />
        </>
      );
    case "dolphin":
      return (
        <>
          <path d="M55 74c8-22 47-31 66-8l24 3-19 15c-7 17-24 23-43 17Z" fill={fill} stroke={dark} strokeWidth="2" />
          <path className="zazoo__fin" d="M70 93 48 119l32-10Z" fill={dark} />
          <path className="zazoo__fin" d="m107 95 26 22-34-8Z" fill={dark} />
          <path d="m58 78-20-15 7 24Z" fill={dark} />
        </>
      );
    case "dog":
      return (
        <>
          <path className="zazoo__ear zazoo__ear--left" d="M52 58C30 43 25 69 39 92c10-3 19-13 25-27Z" fill={dark} />
          <path className="zazoo__ear zazoo__ear--right" d="M128 58c22-15 27 11 13 34-10-3-19-13-25-27Z" fill={dark} />
          <ellipse cx="90" cy="108" rx="26" ry="18" fill="#F0D9BC" opacity=".9" />
          <path className="zazoo__tail" d="M139 145c26-11 33 12 15 29 2-13-6-18-19-12Z" fill={dark} />
        </>
      );
    case "bear":
      return (
        <>
          <circle className="zazoo__ear zazoo__ear--left" cx="49" cy="54" r="18" fill={dark} />
          <circle className="zazoo__ear zazoo__ear--right" cx="131" cy="54" r="18" fill={dark} />
          <circle cx="49" cy="54" r="10" fill="#D2B69E" />
          <circle cx="131" cy="54" r="10" fill="#D2B69E" />
          <ellipse cx="90" cy="107" rx="27" ry="20" fill="#D2B69E" opacity=".9" />
        </>
      );
  }
}

function RoleAccessory({ species, accent }: { species: ZazooSpecies; accent: string }) {
  switch (species) {
    case "owl":
      return <path d="M78 154h24v27H78Z" fill="#F0EEE8" stroke={accent} strokeWidth="2" />;
    case "fox":
      return (
        <>
          <circle cx="67" cy="91" r="13" fill="none" stroke="#1A2B3C" strokeWidth="2.5" />
          <circle cx="106" cy="91" r="13" fill="none" stroke="#1A2B3C" strokeWidth="2.5" />
          <path d="M80 90h13" stroke="#1A2B3C" strokeWidth="2.5" />
          <path d="M65 162h29v22H65Z" fill="#F0EEE8" stroke={accent} strokeWidth="2" />
        </>
      );
    case "elephant":
      return <path d="M67 166h46l-4 18H71Z" fill="#F0EEE8" stroke={accent} strokeWidth="2" />;
    case "beaver":
      return (
        <>
          <path d="M61 174h58" stroke="#C4955A" strokeWidth="7" />
          <path d="m102 164 13-9 5 7-13 9Z" fill={accent} />
        </>
      );
    case "swan":
      return <path d="M57 166c22-13 44-13 66 0-17 2-25 8-33 17-8-9-17-15-33-17Z" fill={accent} />;
    case "dolphin":
      return <path d="M65 171h50l-9 17H74Z" fill="#F0EEE8" stroke={accent} strokeWidth="2" />;
    case "dog":
      return (
        <>
          <path d="M90 129v31" stroke={accent} strokeWidth="3" />
          <rect x="79" y="153" width="22" height="18" rx="3" fill="#F0EEE8" stroke={accent} strokeWidth="2" />
        </>
      );
    case "bear":
      return (
        <>
          <rect x="63" y="158" width="50" height="30" rx="3" fill="#F0EEE8" stroke={accent} strokeWidth="2" />
          <path d="M73 168h30M73 176h23" stroke={accent} strokeWidth="2" />
        </>
      );
  }
}

export function ZazooCharacter({
  species,
  pose = "working",
  accent = "#4D7EA8",
  className = "",
  style,
  labelled = false,
}: ZazooCharacterProps) {
  const rawId = useId();
  const id = rawId.replace(/:/g, "");
  const colors = bodyColors[species];

  return (
    <svg
      className={`zazoo zazoo--${species} zazoo--${pose} ${className}`}
      viewBox="0 0 180 220"
      style={style}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? `${species} Zazoo` : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <defs>
        <radialGradient id={`felt-${id}`} cx="35%" cy="25%" r="85%">
          <stop offset="0%" stopColor={colors.light} />
          <stop offset="72%" stopColor={colors.base} />
          <stop offset="100%" stopColor={colors.dark} />
        </radialGradient>
        <linearGradient id={`suit-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38526E" />
          <stop offset="100%" stopColor="#1A2B3C" />
        </linearGradient>
        <pattern id={`grain-${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="3" r=".7" fill="#FFF" opacity=".18" />
          <circle cx="7" cy="6" r=".6" fill="#1A2B3C" opacity=".08" />
        </pattern>
      </defs>

      <ellipse className="zazoo__shadow" cx="90" cy="207" rx="48" ry="8" fill="#1A2B3C" opacity=".12" />
      <g className="zazoo__legs">
        <path d="M67 178v24" stroke={colors.dark} strokeWidth="13" strokeLinecap="round" />
        <path d="M113 178v24" stroke={colors.dark} strokeWidth="13" strokeLinecap="round" />
      </g>
      <g className="zazoo__body">
        <path
          d="M90 40c42 0 64 36 64 88 0 51-26 76-64 76s-64-25-64-76c0-52 22-88 64-88Z"
          fill={`url(#felt-${id})`}
          stroke={colors.dark}
          strokeWidth="2"
        />
        <path
          d="M31 142c15-14 35-21 59-21s44 7 59 21c0 39-23 62-59 62s-59-23-59-62Z"
          fill={`url(#suit-${id})`}
        />
        <path d="m65 126 25 24 25-24-12-7-13 17-13-17Z" fill="#FFFDF7" />
        <path d="M32 139c-1 31 6 51 21 59M148 139c1 31-6 51-21 59" stroke="#2E4057" strokeWidth="3" opacity=".45" />
        <SpeciesDetails species={species} fill={colors.base} dark={colors.dark} />

        <g className="zazoo__face">
          <ellipse cx="67" cy="89" rx="15" ry="18" fill="#292833" />
          <ellipse cx="113" cy="89" rx="15" ry="18" fill="#292833" />
          <circle cx="62" cy="83" r="5" fill="#FFF" />
          <circle cx="108" cy="83" r="5" fill="#FFF" />
          <circle cx="72" cy="96" r="2.3" fill="#FFF" opacity=".7" />
          <circle cx="118" cy="96" r="2.3" fill="#FFF" opacity=".7" />
          <ellipse cx="53" cy="108" rx="9" ry="5" fill={colors.blush} opacity=".45" />
          <ellipse cx="127" cy="108" rx="9" ry="5" fill={colors.blush} opacity=".45" />
          <path d="m86 104 4 4 4-4-4-3Z" fill="#C98572" />
          <path className="zazoo__mouth" d="M82 114q8 7 16 0" fill="none" stroke="#7C594D" strokeWidth="2.4" strokeLinecap="round" />
        </g>

        <g className="zazoo__hands">
          <ellipse className="zazoo__hand zazoo__hand--left" cx="68" cy="170" rx="13" ry="11" fill={colors.base} stroke={colors.dark} strokeWidth="2" />
          <ellipse className="zazoo__hand zazoo__hand--right" cx="112" cy="170" rx="13" ry="11" fill={colors.base} stroke={colors.dark} strokeWidth="2" />
        </g>
        <RoleAccessory species={species} accent={accent} />
        <path d="M31 48h118v145H31Z" fill={`url(#grain-${id})`} opacity=".22" pointerEvents="none" />
      </g>
    </svg>
  );
}

export function QuietRobot({ className = "" }: { className?: string }) {
  return (
    <svg className={`quiet-robot ${className}`} viewBox="0 0 120 150" aria-hidden="true" focusable="false">
      <ellipse cx="60" cy="140" rx="35" ry="6" fill="#1A2B3C" opacity=".1" />
      <rect x="25" y="38" width="70" height="66" rx="22" fill="#C9CDD0" stroke="#6F7880" strokeWidth="3" />
      <rect x="36" y="51" width="48" height="28" rx="12" fill="#2E4057" />
      <circle cx="50" cy="65" r="4" fill="#A45D58" />
      <circle cx="70" cy="65" r="4" fill="#A45D58" />
      <path d="M60 38V23m-7 0h14" stroke="#6F7880" strokeWidth="4" strokeLinecap="round" />
      <path d="M39 103v25m42-25v25M25 65 9 83m86-18 16 18" stroke="#6F7880" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}
