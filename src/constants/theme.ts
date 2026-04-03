import { Dimensions } from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export const Colors = {
  primary: "#0B8457",
  primaryLight: "#E8F5EE",
  primaryDark: "#065E3C",

  secondary: "#1A1A2E",
  secondaryLight: "#2D2D44",

  accent: "#F59E0B",
  accentLight: "#FEF3C7",

  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  errorLight: "#FEE2E2",
  info: "#3B82F6",

  background: "#F8FAFB",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",

  text: "#1A1A2E",
  textSecondary: "#6B7280",
  textTertiary: "#9CA3AF",
  textInverse: "#FFFFFF",
  textOnPrimary: "#FFFFFF",

  border: "#E5E7EB",
  borderLight: "#F3F4F6",
  divider: "#F0F0F0",

  overlay: "rgba(0, 0, 0, 0.5)",

  card: "#FFFFFF",
  inputBackground: "#F9FAFB",
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
  "4xl": 48,
  "5xl": 64,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const FontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
} as const;

export const FontWeight = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export const Shadow = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

// ── Role-based accent palettes ───────────────────────────────────────────────
// driver   → blue   (active, take-charge energy)
// passenger→ green  (brand colour — trusted, eco)
// both     → orange (flexible, dynamic)
// When a 'both' user sets an active_mode, use the matching driver/passenger palette.
export const RoleTheme = {
  driver: {
    primary:  "#3B82F6",
    dark:     "#1D4ED8",
    light:    "#EFF6FF",
    border:   "#BFDBFE",
    text:     "#1E40AF",
    label:    "Always Drive",
    icon:     "car-sport-outline" as const,
    badge:    "Driver",
  },
  passenger: {
    primary:  "#0B8457",
    dark:     "#065E3C",
    light:    "#E8F5EE",
    border:   "#A7F3D0",
    text:     "#065E3C",
    label:    "Always Ride",
    icon:     "people-outline" as const,
    badge:    "Passenger",
  },
  both: {
    primary:  "#F59E0B",
    dark:     "#D97706",
    light:    "#FEF3C7",
    border:   "#FDE68A",
    text:     "#92400E",
    label:    "Flexible",
    icon:     "swap-horizontal-outline" as const,
    badge:    "Flexible",
  },
} as const;

export type RoleKey = keyof typeof RoleTheme;

/** Returns the palette for the currently active UI context.
 *  - Fixed roles map directly.
 *  - 'both' uses the active_mode sub-palette, or the 'both'/orange palette if unset. */
export function getRolePalette(
  role: "driver" | "passenger" | "both",
  activeMode?: "driver" | "passenger" | null
) {
  if (role === "both" && activeMode) return RoleTheme[activeMode];
  return RoleTheme[role];
}

export { SCREEN_WIDTH };
