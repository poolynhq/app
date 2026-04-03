import { Alert, Platform } from "react-native";

type AlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
};

/**
 * Cross-platform replacement for Alert.alert.
 *
 * react-native-web ships Alert as a no-op (static alert() {}), so any
 * Alert.alert call on the web build silently does nothing — including the
 * sign-out confirmation. This wrapper delegates to the native Alert on
 * iOS/Android and falls back to window.alert / window.confirm on web.
 */
export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[]
): void {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons);
    return;
  }

  const displayText = message ? `${title}\n\n${message}` : title;

  if (!buttons || buttons.length === 0) {
    window.alert(displayText);
    return;
  }

  const cancelBtn = buttons.find((b) => b.style === "cancel");
  const actionBtns = buttons.filter((b) => b.style !== "cancel");

  if (actionBtns.length === 0) {
    window.alert(displayText);
    cancelBtn?.onPress?.();
    return;
  }

  const confirmed = window.confirm(displayText);
  if (confirmed) {
    actionBtns[0].onPress?.();
  } else {
    cancelBtn?.onPress?.();
  }
}
