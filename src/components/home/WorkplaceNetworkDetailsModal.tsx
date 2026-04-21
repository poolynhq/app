import { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import type { Organisation } from "@/types/database";
import {
  Colors,
  Spacing,
  BorderRadius,
  FontSize,
  FontWeight,
  Shadow,
} from "@/constants/theme";

type AdminRow = { full_name: string | null; email: string | null; phone_number: string | null };

type Props = {
  visible: boolean;
  onClose: () => void;
  variant: "enterprise" | "community";
  org: Organisation | null;
  orgMemberCount: number;
  planLabel: string;
  /** Public URL from `org-logos` when the org has a logo. */
  logoPublicUrl?: string | null;
};

export function WorkplaceNetworkDetailsModal({
  visible,
  onClose,
  variant,
  org,
  orgMemberCount,
  planLabel,
  logoPublicUrl = null,
}: Props) {
  const insets = useSafeAreaInsets();
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [loadingAdmins, setLoadingAdmins] = useState(false);

  useEffect(() => {
    if (!visible || !org?.id) {
      setAdmins(null);
      return;
    }
    let cancelled = false;
    setLoadingAdmins(true);
    void (async () => {
      const { data, error } = await supabase
        .from("users")
        .select("full_name, email, phone_number")
        .eq("org_id", org.id)
        .eq("org_role", "admin")
        .order("full_name", { ascending: true })
        .limit(12);
      if (!cancelled) {
        setAdmins(error ? [] : (data as AdminRow[]) ?? []);
        setLoadingAdmins(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, org?.id]);

  if (!org) return null;

  const isEnterprise = variant === "enterprise";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { marginBottom: Math.max(insets.bottom, Spacing.md) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{isEnterprise ? "Your workplace" : "Your network"}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.orgBlock}>
              {logoPublicUrl ? (
                <View style={styles.orgLogoFrame}>
                  <Image source={{ uri: logoPublicUrl }} style={styles.orgLogoImg} resizeMode="contain" />
                </View>
              ) : null}
              <Text style={styles.orgName}>{org.name}</Text>
              {org.domain ? (
                <Text style={styles.metaLine}>
                  <Text style={styles.metaLabel}>Domain </Text>
                  {org.domain}
                </Text>
              ) : null}
              {isEnterprise ? (
                <Text style={styles.metaLine}>
                  <Text style={styles.metaLabel}>Plan </Text>
                  {planLabel}
                </Text>
              ) : null}
              {orgMemberCount > 0 ? (
                <Text style={styles.metaLine}>
                  <Text style={styles.metaLabel}>{isEnterprise ? "About " : ""}</Text>
                  {orgMemberCount} {isEnterprise ? "members in this network" : "colleagues on Poolyn"}
                </Text>
              ) : null}
            </View>

            <Text style={styles.bodyPara}>
              {isEnterprise
                ? "Workplace network: Discover starts with your org."
                : "Community network: same work email domain. Discover starts with your network."}
            </Text>

            <Text style={styles.sectionLabel}>Network admins</Text>
            {loadingAdmins ? (
              <View style={styles.adminLoading}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : admins && admins.length > 0 ? (
              <View style={styles.adminList}>
                {admins.map((a, i) => (
                  <View key={`${a.email ?? i}`} style={styles.adminCard}>
                    <Text style={styles.adminName}>
                      {(a.full_name ?? "").trim() || "Admin"}
                    </Text>
                    {a.email ? <Text style={styles.adminContact}>{a.email}</Text> : null}
                    {a.phone_number ? <Text style={styles.adminContact}>{a.phone_number}</Text> : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.adminEmpty}>
                Contact details for admins may be limited by privacy settings. Ask your organiser if you need help.
              </Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.md,
  },
  sheet: {
    maxHeight: "88%",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    ...Shadow.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  sheetTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.text,
  },
  scroll: { maxHeight: 420 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingTop: Spacing.md,
  },
  orgBlock: { marginBottom: Spacing.md },
  orgLogoFrame: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    marginBottom: Spacing.sm,
    overflow: "hidden",
  },
  orgLogoImg: { width: "100%", height: "100%" },
  orgName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  metaLine: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: 4,
    lineHeight: 20,
  },
  metaLabel: {
    fontWeight: FontWeight.semibold,
    color: Colors.text,
  },
  bodyPara: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: Spacing.sm,
  },
  adminLoading: { paddingVertical: Spacing.md, alignItems: "center" },
  adminList: { gap: Spacing.sm },
  adminCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  adminName: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.text,
    marginBottom: 4,
  },
  adminContact: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  adminEmpty: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    lineHeight: 20,
  },
});
