import { useAppState } from "@/components/app-state";
import { useModal } from "@/components/modal-context";
import { ThemedText } from "@/components/themed-text";
import {
    addChatbotMessage,
    deleteChatbotMessages,
    getChatbotMessages,
} from "@/utils/chat";
import { getFirstAidAiResponse } from "@/utils/first-aid-ai";
import type { Message } from "@/utils/first-aid-chatbot";
import { LANG_LABELS, UI, type Lang } from "@/utils/i18n-first-aid";
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

const MIN_TYPING_MS = 1200;

export default function ChatbotPage() {
  const insets = useSafeAreaInsets();
  const { user } = useAppState();
  const { showConfirm } = useModal();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const flatListRef = useRef<FlatList>(null);

  // Load chatbot history for user
  useEffect(() => {
    if (!user?.id) return;
    getChatbotMessages(user.id).then(({ messages }) => {
      if (messages) {
        setMessages(
          messages.map((m) => ({ role: m.role, text: m.message }) as Message),
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
    const typingStartedAt = Date.now();

    try {
      await addChatbotMessage(user.id, "user", trimmed);

      const aiReply = await getFirstAidAiResponse(trimmed, messages, lang);
      const botMsg = aiReply ?? { role: "bot" as const, text: "Sorry, I couldn't reach the AI service right now. Please check your connection and try again." };

      const elapsed = Date.now() - typingStartedAt;
      if (elapsed < MIN_TYPING_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_TYPING_MS - elapsed),
        );
      }

      setMessages((prev) => [...prev, { role: "bot", text: botMsg.text }]);
      await addChatbotMessage(user.id, "bot", botMsg.text);
    } finally {
      setIsTyping(false);
    }
  };

  const handleDeleteHistory = () => {
    if (!user?.id) return;
    showConfirm(
      "Delete chat history",
      "This will permanently remove all your chatbot messages.",
      async () => {
        const { success } = await deleteChatbotMessages(user.id);
        if (success) setMessages([]);
      },
    );
  };

  const handleSubmit = () => {
    void sendMessage();
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 18}
    >
      <StatusBar barStyle="light-content" backgroundColor="#111827" />
      <View style={styles.fullBg} />
      <View
        style={[
          styles.safeFrame,
          {
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <View style={styles.centeredBox}>
          <View style={styles.topBar}>
            <ThemedText style={styles.topBarTitle}>Chatbot</ThemedText>
            <View style={styles.topBarRight}>
              <View style={styles.langRow}>
                {(["en", "am", "om"] as Lang[]).map((code) => {
                  const active = lang === code;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => setLang(code)}
                      style={({ pressed }) => [
                        styles.langBtn,
                        active ? styles.langBtnActive : null,
                        pressed ? { opacity: 0.8 } : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.langText,
                          active ? styles.langTextActive : null,
                        ]}
                      >
                        {LANG_LABELS[code]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={handleDeleteHistory}
                style={({ pressed }) => [
                  styles.clearBtn,
                  pressed ? { opacity: 0.75 } : null,
                ]}
              >
                <MaterialIcons
                  name="delete-outline"
                  size={18}
                  color="#FCA5A5"
                />
                <Text style={styles.clearBtnText}>Clear</Text>
              </Pressable>
            </View>
          </View>
          <ThemedText style={styles.welcomeMsg}>
            {UI[lang].welcomeMessage}
          </ThemedText>
          <View style={{ flex: 1 }}>
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
              ListFooterComponent={
                isTyping ? (
                  <View style={styles.typingBubble}>
                    <MaterialIcons
                      name="more-horiz"
                      size={18}
                      color="#93C5FD"
                    />
                    <Text style={styles.typingText}>
                      Assistant is typing...
                    </Text>
                  </View>
                ) : null
              }
              contentContainerStyle={{ paddingBottom: 16, paddingTop: 8 }}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
            />
            <View style={styles.inputBar}>
              <TextInput
                style={styles.input}
                placeholder={UI[lang].inputPlaceholder}
                placeholderTextColor="#94A3B8"
                selectionColor="#60A5FA"
                cursorColor="#60A5FA"
                keyboardAppearance="dark"
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
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#111827",
    position: "relative",
  },
  fullBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#111827",
  },
  safeFrame: {
    flex: 1,
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
    borderRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    alignItems: "stretch",
    justifyContent: "flex-start",
    shadowColor: "#0B1220",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  welcomeMsg: {
    color: "#BFDBFE",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 14,
    textAlign: "center",
    letterSpacing: 0.2,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topBarTitle: {
    color: "#93C5FD",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  langRow: {
    flexDirection: "row",
    gap: 6,
  },
  langBtn: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0B1220",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  langBtnActive: {
    borderColor: "#2563EB",
    backgroundColor: "#1E3A8A",
  },
  langText: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "800",
  },
  langTextActive: {
    color: "#DBEAFE",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#7F1D1D",
    backgroundColor: "#3F1212",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  clearBtnText: {
    color: "#FCA5A5",
    fontSize: 12,
    fontWeight: "800",
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
  typingBubble: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1F2937",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
    marginBottom: 6,
    maxWidth: "70%",
  },
  typingText: {
    color: "#BFDBFE",
    fontSize: 12,
    fontWeight: "700",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 12,
    gap: 8,
    paddingTop: 8,
  },
  input: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    fontWeight: "600",
    backgroundColor: "#0F172A",
    color: "#F8FAFC",
    textAlignVertical: "center",
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
