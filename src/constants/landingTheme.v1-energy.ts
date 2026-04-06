/**
 * Archived palette + tokens for the pre–Option 2 “energy / deep green” marketing landing.
 * Used only by `MarketingLanding.v1-energy.tsx` (not routed). Live site uses `landingTheme.ts`.
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
 * Minimal set of master colours – adjust these first when experimenting.
 * Deeper greens + less washed surfaces + stronger text for on-page contrast.
 */
export const LandingBrand = {
  forest: "#0E3F37",
  forestDeep: "#031510",
  forestInk: "#071C18",

  accent: "#2CDDBE",
  accentVivid: "#5EFFE2",
  accentBright: "#A8F5E6",
  accentDeep: "#0A7D70",
  accentOnDark: "#8CFFF0",

  ink: "#031210",
  muted: "#3A4F49",
  subtle: "#5C6F69",

  pageBg: "#D5EBE4",
  sectionAlt: "#C2E0D6",
  navBg: "#E0F2EB",
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

  tealMuted: rgba(LandingBrand.accentDeep, 0.14),
  tealMutedStrong: rgba(LandingBrand.accentDeep, 0.22),
  tealLine: rgba(LandingBrand.accentDeep, 0.42),

  onDarkFill: "rgba(255, 255, 255, 0.08)",
  onDarkBorder: rgba(LandingBrand.accentVivid, 0.28),
  onForestIconBg: "rgba(255, 255, 255, 0.16)",

  ink: LandingBrand.ink,
  muted: LandingBrand.muted,
  subtle: LandingBrand.subtle,

  pageBg: LandingBrand.pageBg,
  sectionAlt: LandingBrand.sectionAlt,
  white: "#FFFFFF",
  navBg: LandingBrand.navBg,
  navHairline: rgba(LandingBrand.forest, 0.22),

  ghostBorder: rgba(LandingBrand.accentVivid, 0.55),
  outlineTint: rgba(LandingBrand.accentDeep, 0.14),
} as const;

/** Photo overlays and section gradients (follow `LandingBrand`). */
export const LandingGradients = {
  heroPhotoOverlay: [
    rgba(LandingBrand.forestDeep, 0.97),
    rgba(LandingBrand.forest, 0.88),
    rgba(LandingBrand.accentDeep, 0.36),
  ] as readonly [string, string, string],
  impactBand: [
    LandingBrand.forestDeep,
    LandingBrand.forest,
    LandingBrand.accentDeep,
  ] as readonly [string, string, string],
  commArt: [rgba(LandingBrand.forest, 0.14), "#FFFFFF"] as readonly [
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
  navCta: `0 8px 28px ${rgba(LandingBrand.accent, 0.48)}`,
  heroPrimary: `0 14px 44px ${rgba(LandingBrand.accent, 0.52)}`,
  finalCta: `0 16px 48px ${rgba(LandingBrand.accent, 0.5)}`,
  cardSoft: `0 14px 40px ${rgba(LandingBrand.forest, 0.14)}`,
  cardLift: `0 18px 48px ${rgba(LandingBrand.forest, 0.16)}`,
  cardFloat: `0 10px 32px ${rgba(LandingBrand.forest, 0.11)}`,
  forestCard: `0 18px 48px ${rgba(LandingBrand.forestInk, 0.45)}`,
  commArt: `0 22px 56px ${rgba(LandingBrand.forest, 0.14)}`,
  dashCard: `0 22px 56px ${rgba(LandingBrand.forest, 0.16)}`,
} as const;
