export type NotificationPreferenceId =
  | "ride_matches"
  | "ride_reminders"
  | "messages"
  | "match_updates"
  | "schedule_tips"
  | "announcements"
  | "org_updates"
  | "network_membership"
  | "billing_network"
  | "security_account";

export type NotificationPreferenceDef = {
  id: NotificationPreferenceId;
  /** Ionicons glyph name */
  icon: string;
  title: string;
  subtitle: string;
  defaultEnabled: boolean;
};

/** Categories for in-app rows + future push; keys stored in users.notification_preferences. */
export const NOTIFICATION_PREFERENCE_CATALOG: NotificationPreferenceDef[] = [
  {
    id: "ride_matches",
    icon: "car-sport-outline",
    title: "New ride matches",
    subtitle: "When a driver or passenger match is found for you",
    defaultEnabled: true,
  },
  {
    id: "ride_reminders",
    icon: "alarm-outline",
    title: "Ride reminders",
    subtitle: "Reminders before your scheduled commute",
    defaultEnabled: true,
  },
  {
    id: "messages",
    icon: "chatbubble-outline",
    title: "Messages",
    subtitle: "Ride chat and message-related alerts from co-commuters",
    defaultEnabled: true,
  },
  {
    id: "match_updates",
    icon: "refresh-outline",
    title: "Match status updates",
    subtitle: "When a match is accepted, declined, or cancelled",
    defaultEnabled: true,
  },
  {
    id: "schedule_tips",
    icon: "bulb-outline",
    title: "Schedule insights",
    subtitle: "Tips to improve your matching rate based on your schedule",
    defaultEnabled: false,
  },
  {
    id: "announcements",
    icon: "megaphone-outline",
    title: "Poolyn announcements",
    subtitle: "Product updates, new features, and network news",
    defaultEnabled: false,
  },
  {
    id: "org_updates",
    icon: "business-outline",
    title: "Organisation updates",
    subtitle: "Messages from your workplace admin and team network",
    defaultEnabled: true,
  },
  {
    id: "network_membership",
    icon: "git-network-outline",
    title: "Network membership",
    subtitle: "Joining or leaving a workplace network, removals, and Explorer status changes",
    defaultEnabled: true,
  },
  {
    id: "billing_network",
    icon: "card-outline",
    title: "Billing & network status",
    subtitle: "Grace periods, activation, and subscription-related alerts for your organisation",
    defaultEnabled: true,
  },
  {
    id: "security_account",
    icon: "shield-checkmark-outline",
    title: "Account security",
    subtitle: "Password resets, unusual sign-in alerts (when available)",
    defaultEnabled: true,
  },
];

export function defaultNotificationPreferencesJson(): Record<
  string,
  { enabled: boolean }
> {
  const out: Record<string, { enabled: boolean }> = {};
  for (const row of NOTIFICATION_PREFERENCE_CATALOG) {
    out[row.id] = { enabled: row.defaultEnabled };
  }
  return out;
}

export function mergeNotificationPreferences(
  stored: unknown
): Record<string, { enabled: boolean }> {
  const base = defaultNotificationPreferencesJson();
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  const o = stored as Record<string, unknown>;
  for (const id of Object.keys(base)) {
    const row = o[id];
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const en = (row as { enabled?: unknown }).enabled;
      if (typeof en === "boolean") base[id] = { enabled: en };
    }
  }
  return base;
}
