/**
 * Landing colours: tweak `LandingBrand` to trial palettes; `Landing` and shadows derive from it.
 *
 * Previous high-contrast “energy” palette lives in `landingTheme.v1-energy.ts` with the matching
 * page snapshot in `MarketingLanding.v1-energy.tsx` (not routed; for future A/B or rollback).
 */
function rgbChannels(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = rgbChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Option 2 direction: warmer sage, airy page surfaces, softer mint accents, lighter hero overlay
 * so the first screen feels approachable rather than heavy corporate green.
 */
export const LandingBrand = {
  forest: "#2E7A6B",
  forestDeep: "#1E5248",
  forestInk: "#214E45",

  accent: "#7AD9C8",
  accentVivid: "#A8F0E3",
  accentBright: "#D4F7F0",
  accentDeep: "#3A9B89",
  accentOnDark: "#C4FFF3",

  ink: "#1C2622",
  muted: "#516059",
  subtle: "#6E7A73",

  pageBg: "#F4F9F6",
  sectionAlt: "#E6F0EA",
  navBg: "#F8FBF9",
} as const;

export const Landing = {
  forest: LandingBrand.forest,
  forestDeep: LandingBrand.forestDeep,
  forestInk: LandingBrand.forestInk,

  teal: LandingBrand.accent,
  tealVivid: LandingBrand.accentVivid,
  tealBright: LandingBrand.accentBright,
  tealDark: LandingBrand.accentDeep,
  tealOnDark: LandingBrand.accentOnDark,

  tealMuted: rgba(LandingBrand.accentDeep, 0.1),
  tealMutedStrong: rgba(LandingBrand.accentDeep, 0.16),
  tealLine: rgba(LandingBrand.accentDeep, 0.28),

  onDarkFill: "rgba(255, 255, 255, 0.1)",
  onDarkBorder: rgba(LandingBrand.accentVivid, 0.35),
  onForestIconBg: "rgba(255, 255, 255, 0.18)",

  ink: LandingBrand.ink,
  muted: LandingBrand.muted,
  subtle: LandingBrand.subtle,

  pageBg: LandingBrand.pageBg,
  sectionAlt: LandingBrand.sectionAlt,
  white: "#FFFFFF",
  navBg: LandingBrand.navBg,
  navHairline: rgba(LandingBrand.forest, 0.12),

  ghostBorder: rgba(LandingBrand.accentVivid, 0.45),
  outlineTint: rgba(LandingBrand.accentDeep, 0.08),
} as const;

/** Photo overlays and section gradients (follow `LandingBrand`). */
export const LandingGradients = {
  heroPhotoOverlay: [
    rgba(LandingBrand.forestDeep, 0.78),
    rgba(LandingBrand.forest, 0.58),
    rgba(LandingBrand.accentDeep, 0.22),
  ] as readonly [string, string, string],
  impactBand: [
    LandingBrand.forestDeep,
    LandingBrand.forest,
    LandingBrand.accentDeep,
  ] as readonly [string, string, string],
  commArt: [rgba(LandingBrand.forest, 0.1), "#FFFFFF"] as readonly [
    string,
    string,
  ],
  finalBand: [
    LandingBrand.forestDeep,
    LandingBrand.forestInk,
    LandingBrand.accentDeep,
  ] as readonly [string, string, string],
} as const;

export const LandingWebShadow = {
  navCta: `0 6px 22px ${rgba(LandingBrand.accent, 0.32)}`,
  heroPrimary: `0 12px 36px ${rgba(LandingBrand.accent, 0.34)}`,
  finalCta: `0 12px 40px ${rgba(LandingBrand.accent, 0.32)}`,
  cardSoft: `0 10px 32px ${rgba(LandingBrand.forest, 0.08)}`,
  cardLift: `0 14px 40px ${rgba(LandingBrand.forest, 0.1)}`,
  cardFloat: `0 8px 26px ${rgba(LandingBrand.forest, 0.07)}`,
  forestCard: `0 14px 40px ${rgba(LandingBrand.forestInk, 0.28)}`,
  commArt: `0 18px 48px ${rgba(LandingBrand.forest, 0.09)}`,
  dashCard: `0 18px 48px ${rgba(LandingBrand.forest, 0.1)}`,
} as const;
