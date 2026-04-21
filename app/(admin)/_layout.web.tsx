import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, FontSize, FontWeight } from "@/constants/theme";

/**
 * Organisation dashboard is a first-class desktop experience (browser).
 * Use a shorter tab bar than mobile (no home-indicator inset) so content stays visible.
 */
type TabIcon = keyof typeof Ionicons.glyphMap;

const tabs: {
  name: string;
  title: string;
  icon: TabIcon;
  iconFocused: TabIcon;
}[] = [
  { name: "index", title: "Overview", icon: "home-outline", iconFocused: "home" },
  { name: "members", title: "Members", icon: "people-outline", iconFocused: "people" },
  { name: "invite", title: "Invite", icon: "link-outline", iconFocused: "link" },
  { name: "settings", title: "Settings", icon: "settings-outline", iconFocused: "settings" },
  { name: "claim-explorers", title: "Claim", icon: "person-add-outline", iconFocused: "person-add" },
  {
    name: "domain-join-requests",
    title: "Join requests",
    icon: "mail-outline",
    iconFocused: "mail",
  },
  {
    name: "transfer-admin",
    title: "Transfer",
    icon: "swap-horizontal-outline",
    iconFocused: "swap-horizontal",
  },
  { name: "org-paywall", title: "Activate", icon: "lock-closed-outline", iconFocused: "lock-closed" },
];

export default function AdminLayoutWeb() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: {
          fontSize: FontSize.xs,
          fontWeight: FontWeight.medium,
        },
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.borderLight,
          height: 56,
          paddingTop: 6,
          paddingBottom: 8,
        },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            href:
              tab.name === "claim-explorers" ||
              tab.name === "domain-join-requests" ||
              tab.name === "transfer-admin" ||
              tab.name === "org-paywall"
                ? null
                : undefined,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? tab.iconFocused : tab.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
