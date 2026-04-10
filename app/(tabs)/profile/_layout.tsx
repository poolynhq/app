import { Stack } from "expo-router";
import { Colors, FontSize, FontWeight } from "@/constants/theme";

export default function ProfileLayout() {
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
      <Stack.Screen name="vehicles" options={{ title: "My Vehicles" }} />
      <Stack.Screen name="schedule" options={{ title: "Schedule" }} />
      <Stack.Screen
        name="commute-locations"
        options={{
          title: "Commute & pickup",
          headerBackTitle: "Profile",
        }}
      />
      <Stack.Screen name="preferences" options={{ title: "Driver preferences" }} />
      <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
      <Stack.Screen name="activity" options={{ title: "Activity" }} />
      <Stack.Screen
        name="poolyn-credits"
        options={{ title: "Poolyn Credits", headerBackTitle: "Profile" }}
      />
      <Stack.Screen name="workplace-network" options={{ title: "Workplace network" }} />
      <Stack.Screen name="route-groups" options={{ title: "Route groups" }} />
      <Stack.Screen name="crews" options={{ title: "Poolyn Crews" }} />
      <Stack.Screen name="crew-settings/[crewId]" options={{ title: "Crew settings" }} />
      <Stack.Screen name="crew-chat/[tripInstanceId]" options={{ title: "Crew chat" }} />
      <Stack.Screen name="transfer-workplace-admin" options={{ title: "Transfer admin" }} />
      <Stack.Screen name="emergency-contacts" options={{ title: "Emergency Contacts" }} />
      <Stack.Screen name="help-faq" options={{ title: "Help & FAQ" }} />
      <Stack.Screen name="terms" options={{ title: "Terms & Conditions" }} />
      <Stack.Screen name="privacy" options={{ title: "Privacy Policy" }} />
    </Stack>
  );
}
