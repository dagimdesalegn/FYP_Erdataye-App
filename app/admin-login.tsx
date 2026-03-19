import React, { useState } from "react";
import { View, TextInput, Button, Text } from "react-native";
import { useRouter } from "expo-router";

export default function AdminLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = async () => {
    // Replace with real API call
    if (phone && password) {
      router.push("/admin");
    } else {
      setError("Invalid credentials");
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24, fontWeight: "bold", marginBottom: 16 }}>Admin Login</Text>
      <TextInput
        placeholder="Phone"
        value={phone}
        onChangeText={setPhone}
        style={{ width: 240, padding: 8, marginBottom: 12, borderWidth: 1, borderRadius: 8 }}
      />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ width: 240, padding: 8, marginBottom: 12, borderWidth: 1, borderRadius: 8 }}
      />
      {error ? <Text style={{ color: "red", marginBottom: 8 }}>{error}</Text> : null}
      <Button title="Login" onPress={handleLogin} />
    </View>
  );
}
