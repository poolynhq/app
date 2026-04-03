import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

let storageAdapter: {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

if (Platform.OS === "web") {
  storageAdapter = {
    getItem: (key: string) => globalThis.localStorage?.getItem(key) ?? null,
    setItem: (key: string, value: string) =>
      globalThis.localStorage?.setItem(key, value),
    removeItem: (key: string) => globalThis.localStorage?.removeItem(key),
  };
} else {
  storageAdapter = {
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) =>
      SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

// Use runtime schema typing from Supabase responses directly.
// Local handcrafted DB types are still used for row aliases in app code.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: storageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.com.au",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "gmx.com",
  "fastmail.com",
]);

export function isWorkEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return !PERSONAL_DOMAINS.has(domain);
}

/** True if the address (full email or bare domain) uses a common personal provider. */
export function isPersonalEmailDomain(emailOrDomain: string): boolean {
  const raw = emailOrDomain.trim().toLowerCase().replace(/^@/, "");
  const domain = raw.includes("@") ? extractDomain(raw) : raw;
  if (!domain) return false;
  return PERSONAL_DOMAINS.has(domain);
}

export function extractDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}
