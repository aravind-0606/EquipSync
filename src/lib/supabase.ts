import "react-native-url-polyfill/auto";

import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL!;

const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_KEY!;

/*
 * Supabase needs persistent storage for its
 * authentication session.
 *
 * Native:
 *   Use Expo SecureStore.
 *
 * Web:
 *   Use browser localStorage.
 *
 * Server-side Expo Router rendering:
 *   Return null because localStorage does not exist.
 */
const storage = {
  getItem: async (key: string) => {
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.localStorage
      ) {
        return window.localStorage.getItem(key);
      }

      return null;
    }

    return SecureStore.getItemAsync(key);
  },

  setItem: async (
    key: string,
    value: string
  ) => {
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.localStorage
      ) {
        window.localStorage.setItem(
          key,
          value
        );
      }

      return;
    }

    await SecureStore.setItemAsync(
      key,
      value
    );
  },

  removeItem: async (key: string) => {
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.localStorage
      ) {
        window.localStorage.removeItem(key);
      }

      return;
    }

    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);