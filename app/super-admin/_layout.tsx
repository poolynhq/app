import { Stack } from "expo-router";
import { Colors } from "@/constants/theme";

export default function SuperAdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Platform directory" }} />
    </Stack>
  );
}
