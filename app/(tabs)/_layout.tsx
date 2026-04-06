import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { Colors, FontSize, FontWeight, BorderRadius, Shadow, Spacing } from "@/constants/theme";

const tabs: { name: string; title: string }[] = [
  { name: "index", title: "Home" },
  { name: "rides", title: "My Rides" },
  { name: "messages", title: "Messages" },
  { name: "profile", title: "Profile" },
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
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) {
    return <View style={styles.fontBoot} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none", height: 0 },
          tabBarItemStyle: { height: 0, width: 0 },
        }}
      >
        {tabs.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
        ))}
      </Tabs>
      <AdminReturnToDashboard />
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
    bottom: 24,
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
