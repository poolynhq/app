import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { supabase } from "@/lib/supabase";
import { saveExpoPushTokenForUser, shouldRegisterPushOnThisPlatform } from "@/lib/expoPushToken";

const RIDE_CHANNEL_ID = "ride_requests_v1";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(RIDE_CHANNEL_ID, {
    name: "Ride requests",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 400, 200, 400],
    enableVibrate: true,
    enableLights: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Registers Expo push token, saves it for server-side delivery, and shows
 * high-priority local alerts when matching rows are inserted into `notifications`.
 */
export function usePushNotificationsAndRideAlerts(userId: string | null) {
  const channelReady = useRef(false);

  useEffect(() => {
    if (!shouldRegisterPushOnThisPlatform() || !userId) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      await ensureAndroidChannel();
      if (cancelled) return;
      channelReady.current = true;

      if (!Device.isDevice) return;

      const perm = await Notifications.getPermissionsAsync();
      let status = perm.status;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") return;

      let expoToken: string | undefined;
      try {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        expoToken = tokenData.data;
      } catch {
        /* Expo Go or missing EAS projectId for push */
      }
      if (expoToken) await saveExpoPushTokenForUser(userId, expoToken);

      const filter = `user_id=eq.${userId}`;
      channel = supabase
        .channel(`notif-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter,
          },
          async (payload) => {
            const row = payload.new as {
              type?: string;
              title?: string;
              body?: string | null;
            };
            const title = row.title ?? "Poolyn";
            const body = row.body ?? "";
            if (!title.trim() && !String(body).trim()) return;
            await Notifications.scheduleNotificationAsync({
              content: {
                title,
                body,
                sound: Platform.OS === "ios" ? "default" : true,
                priority: Notifications.AndroidNotificationPriority.MAX,
                ...(Platform.OS === "android" ? { channelId: RIDE_CHANNEL_ID } : {}),
                data: { type: row.type ?? "" },
              },
              trigger: null,
            });
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);
}
