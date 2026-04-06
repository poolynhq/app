import { Stack } from "expo-router";
import { Colors, FontSize, FontWeight } from "@/constants/theme";

export default function MessagesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTitleStyle: {
          color: Colors.text,
          fontWeight: FontWeight.semibold,
          fontSize: FontSize.base,
        },
        headerTintColor: Colors.primary,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Messages" }} />
      <Stack.Screen name="[rideId]" options={{ title: "Ride chat" }} />
    </Stack>
  );
}
