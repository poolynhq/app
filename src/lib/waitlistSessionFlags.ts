import { Platform } from "react-native";

/** Web sessionStorage: user completed or is already on the waitlist (suppress exit prompt). */
export const WAITLIST_JOINED_SESSION_KEY = "poolyn_waitlist_joined";
/** Web sessionStorage: exit-intent modal was already shown this session. */
export const EXIT_INTENT_SHOWN_SESSION_KEY = "poolyn_exit_intent_waitlist_shown";

export function markWaitlistJoinedInSession() {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(WAITLIST_JOINED_SESSION_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function hasWaitlistJoinedInSession(): boolean {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(WAITLIST_JOINED_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markExitIntentShownInSession() {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(EXIT_INTENT_SHOWN_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function hasExitIntentShownInSession(): boolean {
  if (Platform.OS !== "web" || typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(EXIT_INTENT_SHOWN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
