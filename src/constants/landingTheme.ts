/**
 * Marketing landing tokens: natural leaf greens (warm chlorophyll) + orange accent + mint surfaces.
 * Archive of the earlier mint-forward variant: `landingTheme.v1-energy.ts`.
 */
import { Platform } from "react-native";

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

export const LandingBrand = {
  /** Primary brand green: mid leaf, readable with white type */
  forest: "#3A7F5F",
  /** Hero / footer / dark bands: shaded leaf, still green not charcoal */
  forestDeep: "#2A5A45",
  forestInk: "#305745",

  /** Sunlit leaf highlight for accents on light backgrounds */
  leaf: "#52B57A",
  leafMuted: "#D9EDE0",

  orange: "#F59E0B",
  orangeBright: "#FBBF24",
  onOrange: "#1A1C1B",

  /** Inline emphasis on light sections (leaf shadow, not blue-teal) */
  emphasisTeal: "#2C7156",

  ink: "#1B2421",
  muted: "#4B5652",
  subtle: "#6C7670",

  pageBg: "#F3F7F4",
  sectionAlt: "#EAEFE9",
  mintSurface: "#E4F0E8",
  mintInput: "#EDF5F0",
} as const;

export const Landing = {
  forest: LandingBrand.forest,
  forestDeep: LandingBrand.forestDeep,
  forestInk: LandingBrand.forestInk,

  leaf: LandingBrand.leaf,
  leafMuted: LandingBrand.leafMuted,

  orange: LandingBrand.orange,
  orangeBright: LandingBrand.orangeBright,
  onOrange: LandingBrand.onOrange,
  emphasisTeal: LandingBrand.emphasisTeal,

  /**
   * Legacy `teal*` keys: mint + leaf (not orange). Use `orange` / `onOrange` for CTAs and hero stats.
   */
  teal: LandingBrand.leaf,
  tealVivid: LandingBrand.orangeBright,
  tealBright: LandingBrand.leafMuted,
  tealDark: LandingBrand.emphasisTeal,
  tealOnDark: LandingBrand.orangeBright,
  tealMuted: rgba(LandingBrand.leaf, 0.14),
  tealMutedStrong: rgba(LandingBrand.leaf, 0.22),
  tealLine: rgba(LandingBrand.forest, 0.12),

  onDarkFill: "rgba(255, 255, 255, 0.06)",
  onDarkBorder: rgba(LandingBrand.orange, 0.35),
  onForestIconBg: "rgba(255, 255, 255, 0.14)",

  ink: LandingBrand.ink,
  muted: LandingBrand.muted,
  subtle: LandingBrand.subtle,

  pageBg: LandingBrand.pageBg,
  sectionAlt: LandingBrand.sectionAlt,
  mintSurface: LandingBrand.mintSurface,
  mintInput: LandingBrand.mintInput,
  white: "#FFFFFF",
  navBg: "transparent",
  navHairline: "transparent",

  ghostBorder: "rgba(255,255,255,0.42)",
  outlineTint: rgba(LandingBrand.emphasisTeal, 0.08),
} as const;

export const LandingGradients = {
  /** Hero photo tint (forest haze over the road image). */
  heroPhotoOverlay: [
    rgba(LandingBrand.forestDeep, 0.94),
    rgba(LandingBrand.forest, 0.82),
    rgba(LandingBrand.forestInk, 0.55),
  ] as readonly [string, string, string],
  impactBand: [
    LandingBrand.forestDeep,
    LandingBrand.forest,
    LandingBrand.forestInk,
  ] as readonly [string, string, string],
  commArt: [rgba(LandingBrand.leaf, 0.12), LandingBrand.mintSurface] as readonly [
    string,
    string,
  ],
} as const;

export const LandingWebShadow = {
  navCta: `0 6px 20px ${rgba(LandingBrand.forestDeep, 0.35)}`,
  heroPrimary: `0 10px 32px ${rgba(LandingBrand.orange, 0.35)}`,
  finalCta: `0 10px 28px ${rgba(LandingBrand.forestDeep, 0.25)}`,
  cardSoft: `0 8px 28px ${rgba(LandingBrand.forest, 0.08)}`,
  cardLift: `0 12px 36px ${rgba(LandingBrand.forest, 0.1)}`,
  cardFloat: `0 8px 24px ${rgba(LandingBrand.forest, 0.06)}`,
  forestCard: `0 14px 40px ${rgba(LandingBrand.forestInk, 0.35)}`,
  commArt: `0 16px 44px ${rgba(LandingBrand.forest, 0.08)}`,
  dashCard: `0 16px 44px ${rgba(LandingBrand.forest, 0.1)}`,
} as const;

const impactPlusPatternSvg = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><text x='16' y='20' font-size='11' fill='%23ffffff' fill-opacity='0.07' text-anchor='middle' font-family='ui-sans-serif,system-ui,sans-serif'>+</text></svg>"
);

/** Subtle “+” grid for the impact band (web only; RN native skips). */
export const landingImpactPatternWeb: Record<string, string> =
  Platform.OS === "web"
    ? {
        backgroundImage: `url("data:image/svg+xml,${impactPlusPatternSvg}")`,
        backgroundSize: "32px 32px",
      }
    : {};
