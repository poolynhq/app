import { View, Text, StyleSheet, Platform, TouchableOpacity } from "react-native";
import { Tabs, useRouter, router as expoRouter } from "expo-router";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { Colors, FontSize, FontWeight, BorderRadius, Shadow, Spacing } from "@/constants/theme";

const TAB_DEFS: {
  name: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconFocused: keyof typeof Ionicons.glyphMap;
}[] = [
  { name: "home", title: "Home", icon: "home-outline", iconFocused: "home" },
  { name: "rides", title: "My rides", icon: "car-outline", iconFocused: "car" },
  { name: "navigate", title: "Navigate", icon: "navigate-outline", iconFocused: "navigate" },
  { name: "messages", title: "Messages", icon: "chatbubbles-outline", iconFocused: "chatbubbles" },
  { name: "profile", title: "Profile", icon: "person-outline", iconFocused: "person" },
];

/** Always land on each tab's root screen (My rides listing, Profile menu), not a nested stack route. */
function ridesTabListeners() {
  return {
    tabPress: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      expoRouter.replace("/(tabs)/rides");
    },
  };
}

function profileTabListeners() {
  return {
    tabPress: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      expoRouter.replace("/(tabs)/profile");
    },
  };
}

function AdminReturnToDashboard({ fabBottom }: { fabBottom: number }) {
  const { isAdmin } = useAuth();
  const router = useRouter();
  if (!isAdmin) return null;
  return (
    <TouchableOpacity
      style={[styles.adminFab, { bottom: fabBottom }]}
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
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const insets = useSafeAreaInsets();
  const tabBarBottom = Math.max(insets.bottom, Platform.OS === "web" ? 12 : 8);
  /** Room for icon + label above home indicator (taller bar avoids clipping multi-word labels). */
  const tabBarContentMin = Platform.OS === "android" ? 64 : Platform.OS === "ios" ? 58 : 56;
  const tabBarHeight = tabBarContentMin + tabBarBottom;

  if (!fontsLoaded) {
    return <View style={styles.fontBoot} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textTertiary,
          tabBarAllowFontScaling: false,
          tabBarLabelStyle: {
            fontSize: 9,
            fontWeight: FontWeight.semibold,
            marginTop: 2,
            marginBottom: Platform.OS === "ios" ? 6 : 8,
            lineHeight: 11,
          },
          tabBarIconStyle: {
            marginTop: Platform.OS === "android" ? 2 : 2,
            marginBottom: 0,
          },
          tabBarItemStyle: {
            paddingTop: 4,
            paddingBottom: 0,
          },
          tabBarStyle: {
            paddingTop: Platform.OS === "android" ? 4 : 6,
            paddingBottom: tabBarBottom,
            height: tabBarHeight,
            minHeight: tabBarHeight,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: Colors.border,
            backgroundColor: Colors.surface,
          },
        }}
      >
        {TAB_DEFS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            listeners={
              tab.name === "profile"
                ? profileTabListeners
                : tab.name === "rides"
                  ? ridesTabListeners
                  : undefined
            }
            options={{
              title: tab.title,
              tabBarIcon: ({ color, focused, size }) => (
                <Ionicons name={focused ? tab.iconFocused : tab.icon} size={size ?? 22} color={color} />
              ),
            }}
          />
        ))}
      </Tabs>
      <AdminReturnToDashboard fabBottom={tabBarHeight + 12} />
    </View>
  );
}

const styles = StyleSheet.create({
  fontBoot: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  adminFab: {
    position: "absolute",
    right: Spacing.base,
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
