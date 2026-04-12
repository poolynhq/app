import { Stack } from "expo-router";
import { Colors, FontSize, FontWeight } from "@/constants/theme";

export default function RidesLayout() {
  return (
    <Stack
      initialRouteName="index"
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
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="post-dated-trip"
        options={{ title: "Post a dated trip", headerBackTitle: "Rides" }}
      />
      <Stack.Screen name="search-seat" options={{ headerShown: false }} />
      <Stack.Screen name="trip/[rideId]" options={{ title: "Trip details", headerBackTitle: "Rides" }} />
    </Stack>
  );
}
