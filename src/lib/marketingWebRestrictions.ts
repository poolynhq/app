import { useEffect, useState } from "react";
import { Platform } from "react-native";

/** `(auth)` child segment names that create or start account creation — blocked on marketing web. */
export const MARKETING_BLOCKED_AUTH_SEGMENTS = new Set([
  "sign-up",
  "business-sign-up",
  "start",
  "join-org",
]);

/**
 * Web marketing deploys: block account-creation routes so the site stays waitlist-only.
 *
 * Set either (or both) in Vercel:
 * - EXPO_PUBLIC_MARKETING_WEB_ONLY=1 — blocks sign-up flows on every web build (simplest).
 * - EXPO_PUBLIC_SIGNUP_DISABLED_HOSTS=your-app.vercel.app,www.example.com — block only on
 *   those hostnames (same build can power app + marketing if hosts differ).
 */
export function isAccountSignupBlockedOnWeb(): boolean {
  if (Platform.OS !== "web") return false;

  const flag = process.env.EXPO_PUBLIC_MARKETING_WEB_ONLY;
  if (flag === "1" || flag === "true") return true;

  const raw = process.env.EXPO_PUBLIC_SIGNUP_DISABLED_HOSTS?.trim();
  if (!raw || typeof window === "undefined") return false;

  const host = window.location.hostname.toLowerCase();
  const hosts = raw
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(host);
}

/** Same rules as {@link isAccountSignupBlockedOnWeb}; hostname check runs after mount on web. */
export function useAccountSignupBlockedOnWeb(): boolean {
  const [blocked, setBlocked] = useState(() => {
    if (Platform.OS !== "web") return false;
    const flag = process.env.EXPO_PUBLIC_MARKETING_WEB_ONLY;
    return flag === "1" || flag === "true";
  });

  useEffect(() => {
    if (Platform.OS !== "web") return;
    setBlocked(isAccountSignupBlockedOnWeb());
  }, []);

  return blocked;
}
