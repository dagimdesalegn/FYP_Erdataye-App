import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  getFirstAidAiResponse,
  isFirstAidAiConfigured,
} from "@/utils/first-aid-ai";
import { getBotResponse, type Message } from "@/utils/first-aid-chatbot";
import { type Lang, LANG_LABELS, UI } from "@/utils/i18n-first-aid";
import { useRouter } from "expo-router";

// ─── Markdown bold renderer ─────────────────────────────────────────────────
function MarkdownText({ text, style }: { text: string; style?: object }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <ThemedText style={style}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <ThemedText key={i} style={[style, { fontWeight: "800" }]}>
            {part}
          </ThemedText>
        ) : (
          part
        )
      )}
    </ThemedText>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────────
function MessageBubble({
  message,
  isDark,
}: {
  message: Message;
  isDark: boolean;
}) {
  const isBot = message.role === "bot";

  return (
    <View
      style={[
        styles.bubbleRow,
        isBot ? styles.bubbleRowBot : styles.bubbleRowUser,
      ]}
    >
      {isBot && (
        <View style={styles.avatar}>
          <MaterialIcons name="local-hospital" size={16} color="#fff" />
        </View>
      )}
      <View style={[styles.bubbleContent, !isBot && { alignItems: "flex-end" }]}>
        <View
          style={[
            styles.bubble,
            isBot
              ? [
                  styles.bubbleBot,
                  {
                    backgroundColor: isDark ? "#1E293B" : "#F1F5F9",
                    borderColor: isDark ? "#334155" : "#E2E8F0",
                  },
                ]
              : [
                  styles.bubbleUser,
                  {
                    backgroundColor: "#DC2626",
                    borderColor: "#B91C1C",
                  },
                ],
          ]}
        >
          <MarkdownText
            text={message.text}
            style={[
              styles.bubbleText,
              {
                color: isBot ? (isDark ? "#E2E8F0" : "#1E293B") : "#FFFFFF",
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

// ─── Typing indicator ───────────────────────────────────────────────────────
function TypingIndicator({ isDark }: { isDark: boolean }) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: -6,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.delay(600),
        ])
      );
    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 150);
    const a3 = animate(dot3, 300);
    a1.start();
    a2.start();
    a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  const dotColor = isDark ? "#64748B" : "#94A3B8";

  return (
    <View style={[styles.bubbleRow, styles.bubbleRowBot]}>
      <View style={styles.avatar}>
        <MaterialIcons name="local-hospital" size={16} color="#fff" />
      </View>
      <View
        style={[
          styles.bubble,
          styles.bubbleBot,
          {
            backgroundColor: isDark ? "#1E293B" : "#F1F5F9",
            borderColor: isDark ? "#334155" : "#E2E8F0",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 18,
            paddingVertical: 14,
          },
        ]}
      >
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              { backgroundColor: dotColor, transform: [{ translateY: dot }] },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Main chat screen ───────────────────────────────────────────────────────
export default function FirstAidChatScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const colors = Colors[colorScheme];
  const aiConfigured = isFirstAidAiConfigured();

  const [lang, setLang] = useState<Lang>("en");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const bg = isDark ? "#0F172A" : "#F8FAFC";
  const headerBg = isDark ? "#1E293B" : "#FFFFFF";
  const borderClr = isDark ? "#334155" : "#E2E8F0";
  const inputBg = isDark ? "#1E293B" : "#FFFFFF";
  const textClr = isDark ? "#F1F5F9" : "#0F172A";
  const mutedClr = isDark ? "#64748B" : "#94A3B8";

  const scrollToBottom = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isTyping) return;

      const userMsg: Message = { role: "user", text: trimmed };
      const historyForReply = [...messages, userMsg];
      setMessages((prev) => [...prev, userMsg]);
      setInputText("");
      setIsTyping(true);
      scrollToBottom();

      const fetchReply = async () => {
        const aiReply = await getFirstAidAiResponse(trimmed, historyForReply, lang);
        const botMsg: Message = aiReply ?? getBotResponse(trimmed, lang);
        setMessages((prev) => [...prev, botMsg]);
        setIsTyping(false);
        scrollToBottom();
      };

      void fetchReply();
    },
    [isTyping, messages, scrollToBottom, lang]
  );

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 10,
            backgroundColor: headerBg,
            borderBottomColor: borderClr,
            shadowColor: isDark ? "#000" : "#94A3B8",
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: isDark ? "#334155" : "#F1F5F9" },
            pressed && { opacity: 0.7 },
          ]}
        >
          <MaterialIcons name="arrow-back" size={20} color={textClr} />
        </Pressable>

        <View style={styles.headerCenter}>
          <View style={styles.headerIcon}>
            <MaterialIcons name="local-hospital" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.headerTitle, { color: textClr }]}>
              First Aid Assistant
            </ThemedText>
            <View style={styles.statusRow}>
              <View style={styles.onlineDot} />
              <ThemedText style={[styles.headerSub, { color: mutedClr }]}>
                {aiConfigured ? "AI Powered" : "Offline Mode"}
              </ThemedText>
            </View>
          </View>
        </View>

        {/* Language pills */}
        <View style={styles.langRow}>
          {(["en", "am", "om"] as Lang[]).map((l) => (
            <Pressable
              key={l}
              onPress={() => {
                if (l !== lang) {
                  setLang(l);
                  setMessages([]);
                }
              }}
              style={[
                styles.langChip,
                {
                  backgroundColor: l === lang ? "#DC2626" : isDark ? "#334155" : "#F1F5F9",
                  borderColor: l === lang ? "#DC2626" : borderClr,
                },
              ]}
            >
              <ThemedText
                style={[
                  styles.langChipText,
                  { color: l === lang ? "#fff" : mutedClr },
                ]}
              >
                {LANG_LABELS[l]}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      {/* ── Disclaimer ── */}
      <View
        style={[
          styles.disclaimer,
          {
            backgroundColor: isDark ? "#1C0A0A" : "#FEF2F2",
            borderBottomColor: isDark ? "#7F1D1D" : "#FECACA",
          },
        ]}
      >
        <MaterialIcons name="warning-amber" size={16} color="#DC2626" />
        <ThemedText
          style={[styles.disclaimerText, { color: isDark ? "#FCA5A5" : "#B91C1C" }]}
        >
          Life-threatening emergency? Call 911 immediately.
        </ThemedText>
      </View>

      {/* ── Chat area ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <MaterialIcons name="local-hospital" size={40} color="#DC2626" />
            </View>
            <ThemedText style={[styles.emptyTitle, { color: textClr }]}>
              {UI[lang].headerTitle}
            </ThemedText>
            <ThemedText style={[styles.emptySub, { color: mutedClr }]}>
              {UI[lang].inputPlaceholder}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <MessageBubble message={item} isDark={isDark} />
            )}
            ListFooterComponent={isTyping ? <TypingIndicator isDark={isDark} /> : null}
            contentContainerStyle={[styles.messageList, { paddingBottom: 16 }]}
            onContentSizeChange={scrollToBottom}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          />
        )}

        {/* ── Input bar ── */}
        <View
          style={[
            styles.inputBar,
            {
              paddingBottom: Math.max(insets.bottom, 8) + 4,
              backgroundColor: headerBg,
              borderTopColor: borderClr,
              shadowColor: isDark ? "#000" : "#94A3B8",
            },
          ]}
        >
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: inputBg,
                borderColor: borderClr,
              },
            ]}
          >
            <TextInput
              style={[styles.textInput, { color: textClr }]}
              placeholder={UI[lang].inputPlaceholder}
              placeholderTextColor={mutedClr}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={() => sendMessage(inputText)}
              returnKeyType="send"
              multiline
              maxLength={500}
              blurOnSubmit={false}
            />
          </View>
          <Pressable
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || isTyping}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor:
                  inputText.trim() && !isTyping
                    ? "#DC2626"
                    : isDark
                      ? "#334155"
                      : "#E2E8F0",
              },
              pressed && { opacity: 0.8 },
            ]}
          >
            <MaterialIcons
              name="send"
              size={20}
              color={inputText.trim() && !isTyping ? "#FFFFFF" : mutedClr}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: Fonts.sans,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#22C55E",
  },
  langRow: {
    flexDirection: "row",
    gap: 4,
  },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  langChipText: {
    fontSize: 11,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },

  // Disclaimer
  disclaimer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  disclaimerText: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    flex: 1,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: Fonts.sans,
    textAlign: "center",
    lineHeight: 20,
  },

  // Messages
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 4,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    marginBottom: 12,
  },
  bubbleRowBot: { justifyContent: "flex-start" },
  bubbleRowUser: { justifyContent: "flex-end" },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  bubbleContent: {
    flex: 1,
    maxWidth: "85%",
    gap: 4,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: "100%",
    borderWidth: 1,
  },
  bubbleBot: {
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    borderBottomRightRadius: 4,
    alignSelf: "flex-end",
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: Fonts.sans,
  },

  // Typing indicator
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 4,
  },
  inputWrap: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  textInput: {
    paddingHorizontal: 18,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
    fontFamily: Fonts.sans,
    maxHeight: 110,
    minHeight: 46,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    shadowColor: "#DC2626",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
});
