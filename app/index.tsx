import { Platform, View, StyleSheet } from "react-native";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import MarketingLanding from "@/components/landing/MarketingLanding";
import { Landing } from "@/constants/landingTheme";

/**
 * Sole owner of URL `/` so it does not compete with `app/(tabs)/home` (app home is `/home`).
 */
export default function MarketingIndexRoute() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  if (!loaded) {
    return <View style={styles.boot} />;
  }

  return (
    <View style={Platform.OS === "web" ? styles.webRoot : styles.nativeRoot}>
      <MarketingLanding />
    </View>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: Landing.pageBg },
  webRoot: { flex: 1, width: "100%", minHeight: "100%", alignSelf: "stretch" },
  nativeRoot: { flex: 1 },
});
