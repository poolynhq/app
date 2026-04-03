import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { Colors, FontSize, FontWeight, BorderRadius, Shadow, Spacing } from "@/constants/theme";

type TabIcon = keyof typeof Ionicons.glyphMap;

const tabs: {
  name: string;
  title: string;
  icon: TabIcon;
  iconFocused: TabIcon;
}[] = [
  {
    name: "index",
    title: "Home",
    icon: "home-outline",
    iconFocused: "home",
  },
  {
    name: "rides",
    title: "My Rides",
    icon: "car-outline",
    iconFocused: "car",
  },
  {
    name: "discover",
    title: "Discover",
    icon: "compass-outline",
    iconFocused: "compass",
  },
  {
    name: "profile",
    title: "Profile",
    icon: "person-outline",
    iconFocused: "person",
  },
];

function AdminReturnToDashboard() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  if (!isAdmin) return null;
  return (
    <TouchableOpacity
      style={styles.adminFab}
      onPress={() => router.push("/(admin)/")}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel="Open network admin dashboard"
    >
      <Ionicons name="business" size={18} color={Colors.textOnPrimary} />
      <Text style={styles.adminFabText}>Admin</Text>
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
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
    <AdminReturnToDashboard />
    </View>
  );
}

const styles = StyleSheet.create({
  adminFab: {
    position: "absolute",
    right: Spacing.base,
    bottom: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary,
    ...Shadow.md,
    zIndex: 50,
  },
  adminFabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
});
