import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  FontSize,
  FontWeight,
  BorderRadius,
} from "@/constants/theme";

export type DiscoverMapLegendLens = "driver" | "passenger" | "flex_none" | "overview";

type Props = {
  lens: DiscoverMapLegendLens;
  /** When viewer has a saved route, peer layers are clipped to a band around it */
  corridorBandFilter: boolean;
  /** "network" vs extended / any commuter */
  scopeNetwork: boolean;
  /** Tighter spacing (e.g. home dashboard) */
  compact?: boolean;
};

function Dot({ color }: { color: string }) {
  return (
    <View
      style={[styles.dot, { backgroundColor: color }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

function LegendLine({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.line}>
      <Dot color={color} />
      <Text style={styles.lineText}>{text}</Text>
    </View>
  );
}

function DetailBullet({ children }: { children: string }) {
  return <Text style={styles.detailBullet}>{children}</Text>;
}

export function DiscoverMapLegend({ lens, corridorBandFilter, scopeNetwork, compact }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const scopeShort = scopeNetwork
    ? "Same workplace network only."
    : "May include people outside your org in the wider area, then clipped to your route band.";

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={[styles.headerRow, !detailsOpen && styles.headerRowOnly]}>
        <Text style={styles.cardTitle}>Map key</Text>
        <Pressable
          onPress={() => setDetailsOpen((o) => !o)}
          style={({ pressed }) => [styles.detailsToggle, pressed && styles.detailsTogglePressed]}
          accessibilityRole="button"
          accessibilityLabel={detailsOpen ? "Hide map legend details" : "Show map legend details"}
        >
          <Text style={styles.detailsToggleText}>{detailsOpen ? "Hide details" : "Details"}</Text>
          <Ionicons
            name={detailsOpen ? "chevron-up" : "chevron-down"}
            size={16}
            color={Colors.primary}
          />
        </Pressable>
      </View>

      {detailsOpen ? (
        <View style={styles.detailBubble}>
          <LegendLine color="#16A34A" text="Green and colored lines: your commute options (see counts above)." />
          <LegendLine color="#EA580C" text="Orange heat: where riders show interest (rough, not exact times yet)." />
          <LegendLine color="#22C55E" text="Green dots: other drivers with seats near your corridor." />
          <LegendLine color="#2563EB" text="Blue lines: colleagues’ trips on the board (context, not your route choices)." />

          <Text style={[styles.detailHeading, styles.detailHeadingSpaced]}>Scope</Text>
          <Text style={styles.detailPara}>{scopeShort}</Text>

          <Text style={[styles.detailHeading, styles.detailHeadingSpaced]}>Why blue lines exist</Text>
          <DetailBullet>
            They show where real shared rides already run. Useful if you want corridor context. If you only care about your own paths, you can ignore them.
          </DetailBullet>

          <Text style={[styles.detailHeading, styles.detailHeadingSpaced]}>Blue vs your other colors</Text>
          <DetailBullet>
            Teal, amber, and purple are optional paths for you from directions. Blue is always someone else’s trip, not an alternate for you.
          </DetailBullet>

          {corridorBandFilter ? (
            <>
              <Text style={[styles.detailHeading, styles.detailHeadingSpaced]}>Clipping</Text>
              <DetailBullet>
                Orange heat, driver dots, and blue trip lines stay within a short distance of your saved route (primary plus alternates).
              </DetailBullet>
            </>
          ) : null}

          {lens === "flex_none" ? (
            <>
              <Text style={[styles.detailHeading, styles.detailHeadingSpaced]}>Flexible today</Text>
              <DetailBullet>
                Pick Driving or Riding on Home, then check your colored paths, corridor counts, and green dots before you leave.
              </DetailBullet>
            </>
          ) : null}

          {lens === "driver" ? (
            <>
              <Text style={[styles.detailHeading, styles.detailHeadingSpaced]}>Driving</Text>
              <DetailBullet>
                For which way to drive, use your green and colored paths plus corridor counts. Blue is others’ confirmed trips, not routing advice for you.
              </DetailBullet>
            </>
          ) : null}

          {lens === "passenger" ? (
            <>
              <Text style={[styles.detailHeading, styles.detailHeadingSpaced]}>Riding</Text>
              <DetailBullet>
                Orange mixes onboarded homes in scope with open ride requests. It is not yet filtered to “riding this exact slot.”
              </DetailBullet>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  cardCompact: {
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  headerRowOnly: {
    marginBottom: 0,
  },
  cardTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  detailsTogglePressed: {
    opacity: 0.7,
  },
  detailsToggleText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.primary,
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  lineText: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.text,
    lineHeight: 17,
  },
  detailBubble: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  detailHeading: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  detailHeadingSpaced: {
    marginTop: Spacing.sm,
  },
  detailPara: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 4,
  },
  detailBullet: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 6,
  },
});
