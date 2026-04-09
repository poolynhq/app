import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
} from "@/constants/theme";

export const POOLYN_MINI_TOUR_DONE_KEY = "poolyn_mini_tour_v1_done";

const PAGES: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}[] = [
  {
    icon: "swap-horizontal-outline",
    title: "Driver or rider",
    body: "If you are both, use the chip on Home to say whether you are driving or riding today. That shapes what you see on the map.",
  },
  {
    icon: "map-outline",
    title: "Live route map",
    body: "The routine map shows demand and people along corridors similar to yours. Widen scope to “Any commuter” when your organisation allows it.",
  },
  {
    icon: "chatbubbles-outline",
    title: "Messages & rides",
    body: "Post a pickup from Home when you need a lift; drivers get a push. Coordinate details in ride chat from Messages.",
  },
  {
    icon: "flash-outline",
    title: "Flex Credits",
    body: "Credits cover small changes of plan so carpooling stays low-stress. Points reward reliability over time.",
  },
];

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function PoolynMiniTourModal({ visible, onClose }: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const last = index >= PAGES.length - 1;
  const page = PAGES[index];

  async function finish() {
    try {
      await AsyncStorage.setItem(POOLYN_MINI_TOUR_DONE_KEY, "1");
    } catch {
      /* ignore */
    }
    setIndex(0);
    onClose();
  }

  function next() {
    if (last) void finish();
    else setIndex((i) => i + 1);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <Pressable style={styles.backdrop} onPress={finish}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <Ionicons name={page.icon} size={30} color={Colors.primary} />
          </View>
          <Text style={styles.title}>{page.title}</Text>
          <Text style={styles.body}>{page.body}</Text>
          <View style={styles.dots}>
            {PAGES.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={next} activeOpacity={0.88}>
            <Text style={styles.primaryBtnText}>{last ? "Get started" : "Next"}</Text>
            <Ionicons name="arrow-forward" size={18} color={Colors.textOnPrimary} />
          </TouchableOpacity>
          {Platform.OS !== "web" ? (
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => {
                void (async () => {
                  try {
                    await AsyncStorage.setItem(POOLYN_MINI_TOUR_DONE_KEY, "1");
                  } catch {
                    /* ignore */
                  }
                  setIndex(0);
                  onClose();
                  router.push("/(tabs)/profile/notifications");
                })();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.linkText}>Notification settings</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.skip} onPress={() => void finish()} hitSlop={12}>
            <Text style={styles.skipText}>Skip tour</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: Spacing.lg,
  },
  dots: {
    flexDirection: "row",
    gap: 6,
    marginBottom: Spacing.lg,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  dotOn: {
    backgroundColor: Colors.primary,
    width: 18,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  primaryBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.textOnPrimary,
  },
  linkBtn: {
    alignSelf: "center",
    paddingVertical: Spacing.sm,
  },
  linkText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.primary,
  },
  skip: {
    alignSelf: "center",
    paddingVertical: Spacing.sm,
  },
  skipText: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
});
