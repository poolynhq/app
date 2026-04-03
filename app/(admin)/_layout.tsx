import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, FontSize, FontWeight } from "@/constants/theme";

type TabIcon = keyof typeof Ionicons.glyphMap;

const tabs: {
  name: string;
  title: string;
  icon: TabIcon;
  iconFocused: TabIcon;
}[] = [
  {
    name: "index",
    title: "Overview",
    icon: "home-outline",
    iconFocused: "home",
  },
  {
    name: "members",
    title: "Members",
    icon: "people-outline",
    iconFocused: "people",
  },
  {
    name: "invite",
    title: "Invite",
    icon: "link-outline",
    iconFocused: "link",
  },
  {
    name: "settings",
    title: "Settings",
    icon: "settings-outline",
    iconFocused: "settings",
  },
  {
    name: "claim-explorers",
    title: "Claim",
    icon: "person-add-outline",
    iconFocused: "person-add",
  },
  {
    name: "transfer-admin",
    title: "Transfer",
    icon: "swap-horizontal-outline",
    iconFocused: "swap-horizontal",
  },
  {
    name: "org-paywall",
    title: "Activate",
    icon: "lock-closed-outline",
    iconFocused: "lock-closed",
  },
];

export default function AdminLayout() {
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
          height: 88,
          paddingTop: 8,
          paddingBottom: 28,
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
              tab.name === "transfer-admin" ||
              tab.name === "org-paywall"
                ? null
                : undefined,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? tab.iconFocused : tab.icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
