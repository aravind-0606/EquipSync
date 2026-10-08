import { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";

import { signIn } from "../services/auth";
import { getMyProfile } from "../services/profile";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert(
        "Missing details",
        "Please enter email and password."
      );
      return;
    }

    try {
      setLoading(true);

      // Step 1: Authenticate with Supabase
      await signIn(email.trim(), password);

      // Step 2: Get the user's profile and role
      const profile = await getMyProfile();

      // Step 3: Route according to the user's role
      if (profile.role === "OPERATIONS_MANAGER") {
        router.replace("/manager");
      } else if (profile.role === "TECHNICIAN") {
        router.replace("/technician");
      } else {
        Alert.alert(
          "Role not configured",
          `The ${profile.role} dashboard is not available yet.`
        );
      }
    } catch (error) {
      console.log("LOGIN ERROR:", error);

      Alert.alert(
        "Login failed",
        error instanceof Error
          ? error.message
          : JSON.stringify(error)
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>EquipSync</Text>

      <Text style={styles.subtitle}>
        Industrial Equipment Service Management
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#888"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#888"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleLogin}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Signing in..." : "Sign In"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
    justifyContent: "center",
    padding: 24,
  },

  title: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },

  subtitle: {
    color: "#aaa",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 40,
  },

  input: {
    backgroundColor: "#222",
    color: "#fff",
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    marginBottom: 15,
  },

  button: {
    backgroundColor: "#208AEF",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
  },

  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "bold",
  },
});