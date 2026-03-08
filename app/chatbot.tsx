import { useAppState } from "@/components/app-state";
import { ThemedText } from "@/components/themed-text";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { addChatMessage, getChatHistory } from "@/utils/chat";
import { getFirstAidAiResponse } from "@/utils/first-aid-ai";
import { getBotResponse, type Message } from "@/utils/first-aid-chatbot";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, { useEffect, useRef, useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ChatbotPage() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const { user } = useAppState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Load chat history for user
  useEffect(() => {
    if (!user?.id) return;
    getChatHistory(user.id).then(({ messages }) => {
      if (messages) {
        setMessages(
          messages
            .map((m) => ({ role: "user", text: m.user_message }) as Message)
            .concat(
              messages
                .filter((m) => m.ai_response)
                .map((m) => ({ role: "bot", text: m.ai_response }) as Message),
            ),
        );
      }
    });
  }, [user?.id]);

  useEffect(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages, isTyping]);

  const sendMessage = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || isTyping || !user?.id) return;
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInputText("");
    setIsTyping(true);
    const aiReply = await getFirstAidAiResponse(trimmed, messages, "en");
    const botMsg = aiReply ?? getBotResponse(trimmed, "en");
    setMessages((prev) => [...prev, { role: "bot", text: botMsg.text }]);
    await addChatMessage(user.id, user.id, trimmed, botMsg.text);
    setIsTyping(false);
  };

  const handleSubmit = () => {
    void sendMessage();
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.centeredBox}>
        <ThemedText style={styles.welcomeMsg}>
          👋 Welcome! Ask me anything about first aid or emergencies.
        </ThemedText>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <View
                style={item.role === "user" ? styles.userMsg : styles.botMsg}
              >
                <Text
                  style={{
                    color: item.role === "user" ? "#FFFFFF" : "#E5E7EB",
                    fontWeight: "600",
                    fontSize: 14,
                    lineHeight: 20,
                  }}
                >
                  {item.text}
                </Text>
              </View>
            )}
            contentContainerStyle={{ paddingBottom: 16, paddingTop: 8 }}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          />
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Type your message..."
              placeholderTextColor="#94A3B8"
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSubmit}
              returnKeyType="send"
              multiline={false}
              maxLength={500}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={handleSubmit}
              disabled={!inputText.trim() || isTyping}
              style={styles.sendBtn}
            >
              <MaterialIcons
                name="send"
                size={20}
                color={inputText.trim() && !isTyping ? "#FFFFFF" : "#aaa"}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0B1220",
    alignItems: "center",
    justifyContent: "center",
  },
  centeredBox: {
    width: "94%",
    maxWidth: 560,
    height: "90%",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: "stretch",
    justifyContent: "flex-start",
    shadowColor: "#020617",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  welcomeMsg: {
    color: "#BFDBFE",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center",
    letterSpacing: 0.2,
  },
  userMsg: {
    alignSelf: "flex-end",
    backgroundColor: "#2563EB",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 4,
    maxWidth: "80%",
  },
  botMsg: {
    alignSelf: "flex-start",
    backgroundColor: "#1F2937",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#334155",
    marginVertical: 4,
    maxWidth: "80%",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: "600",
    backgroundColor: "#0F172A",
    color: "#F8FAFC",
    minHeight: 40,
    maxHeight: 48,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    shadowColor: "#1D4ED8",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
});
