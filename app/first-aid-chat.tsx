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
import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    getFirstAidAiResponse,
    isFirstAidAiConfigured,
} from "@/utils/first-aid-ai";
import { type Message } from "@/utils/first-aid-chatbot";
import { type Lang, LANG_LABELS, UI } from "@/utils/i18n-first-aid";
import { useRouter } from "expo-router";

const MIN_TYPING_MS = 1200;

// ─── Plain text renderer (no markdown) ──────────────────────────────────────
function MarkdownText({ text, style }: { text: string; style?: object }) {
  // Strip any asterisks from the text
  const clean = text.replace(/\*+/g, "");
  return <ThemedText style={style}>{clean}</ThemedText>;
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
          <MaterialIcons
            name="local-hospital"
            size={18}
            color={isDark ? "#F87171" : "#DC2626"}
          />
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
  // Simple three-dot motion only, no text
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
        ]),
      );
    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 150);
    const a3 = animate(dot3, 300);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  const dotColor = isDark ? "#64748B" : "#94A3B8";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
      }}
    >
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginHorizontal: 3,
            backgroundColor: dotColor,
            transform: [{ translateY: dot }],
          }}
        />
      ))}
    </View>
  );
}

// ─── Main chat screen ───────────────────────────────────────────────────────
export default function FirstAidChatScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const aiConfigured = isFirstAidAiConfigured();

  const [lang, setLang] = useState<Lang>("en");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const bg = isDark ? "#0B1220" : "#EEF3F8";
  const headerBg = isDark ? "#111827" : "#FFFFFF";
  const borderClr = isDark ? "#293548" : "#D6E0EA";
  // Always use the main chat background for the input bar to prevent black bar
  const inputBarBg = bg;
  const inputBg = isDark ? "#101B2D" : "#FFFFFF";
  const textClr = isDark ? "#E6EDF7" : "#0F172A";
  const mutedClr = isDark ? "#7C8DA6" : "#6B7C93";

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
        const typingStartedAt = Date.now();
        try {
          const aiReply = await getFirstAidAiResponse(
            trimmed,
            historyForReply,
            lang,
          );
          const botMsg: Message = aiReply ?? {
            role: "bot" as const,
            text: "Sorry, I couldn't reach the AI service right now. Please try again shortly.",
          };

          const elapsed = Date.now() - typingStartedAt;
          if (elapsed < MIN_TYPING_MS) {
            await new Promise((resolve) =>
              setTimeout(resolve, MIN_TYPING_MS - elapsed),
            );
          }

          setMessages((prev) => [...prev, botMsg]);
          scrollToBottom();
        } finally {
          setIsTyping(false);
        }
      };

      void fetchReply();
    },
    [isTyping, messages, scrollToBottom, lang],
  );

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: bg, flex: 1 },
      ]}
    >
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
          onPress={() => router.push("/help")}
          style={({ pressed }) => [
            styles.backBtn,
            {
              backgroundColor: isDark ? "#334155" : "#F1F5F9",
              position: "absolute",
              right: 10,
              top: insets.top + 10,
            },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityLabel="Close chatbot"
        >
          <MaterialIcons name="close" size={22} color={textClr} />
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
                  backgroundColor:
                    l === lang ? "#DC2626" : isDark ? "#243244" : "#F1F5F9",
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
          style={[
            styles.disclaimerText,
            { color: isDark ? "#FCA5A5" : "#B91C1C" },
          ]}
        >
          Life-threatening emergency? Call 911 immediately.
        </ThemedText>
      </View>

      {/* ── Chat area ── */}
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: bg }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 18}
      >
        {/* Welcome message always at top */}
        <View style={{ alignItems: "center", marginTop: 8, marginBottom: 4 }}>
          <ThemedText
            style={{ color: "#DC2626", fontSize: 13, fontWeight: "700" }}
          >
            👋 Welcome! Ask me anything about first aid or emergencies.
          </ThemedText>
        </View>
        {messages.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: bg }]}> 
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
          <View style={{ flex: 1, backgroundColor: bg }}>
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <MessageBubble message={item} isDark={isDark} />
              )}
              ListFooterComponent={
                isTyping ? <TypingIndicator isDark={isDark} /> : null
              }
                contentContainerStyle={[styles.messageList, { paddingBottom: 16, backgroundColor: bg }]}
              onContentSizeChange={scrollToBottom}
              showsVerticalScrollIndicator={false}
                style={{ flex: 1, backgroundColor: bg }}
            />
          </View>
        )}

        {/* ── Input bar ── */}
        <View
          style={[
            styles.inputBar,
            {
              paddingBottom: Math.max(insets.bottom, 8) + 4,
              backgroundColor: inputBarBg,
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
              selectionColor={isDark ? "#60A5FA" : "#2563EB"}
              cursorColor={isDark ? "#60A5FA" : "#2563EB"}
              keyboardAppearance={isDark ? "dark" : "light"}
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

// ─── Design tokens ──────────────────────────────────────────────────────────
const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
};

const RADIUS = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 24,
};

const TYPE = {
  caption: 11,
  body: 14,
  bodyLg: 15,
  title: 16,
  hero: 20,
};

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  bgLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  bgBlobTop: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    top: -170,
    right: -95,
    opacity: 0.65,
  },
  bgBlobBottom: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    bottom: -145,
    left: -80,
    opacity: 0.6,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.md,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
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
    fontSize: TYPE.title,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs + 1,
    marginTop: 2,
  },
  headerSub: {
    fontSize: TYPE.caption,
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
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  langChipText: {
    fontSize: TYPE.caption,
    fontWeight: "800",
    fontFamily: Fonts.sans,
  },

  // Disclaimer
  disclaimer: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
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
    gap: SPACING.md,
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
    fontSize: TYPE.hero,
    fontWeight: "800",
    fontFamily: Fonts.sans,
    textAlign: "center",
  },
  emptySub: {
    fontSize: TYPE.body,
    fontWeight: "500",
    fontFamily: Fonts.sans,
    textAlign: "center",
    lineHeight: 20,
  },

  // Messages
  messageList: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 18,
    gap: 4,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: SPACING.sm + 2,
    marginBottom: SPACING.md,
  },
  bubbleRowBot: { justifyContent: "flex-start" },
  bubbleRowUser: { justifyContent: "flex-end" },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "transparent",
  },
  bubbleContent: {
    flex: 1,
    maxWidth: "82%",
    gap: 4,
  },
  bubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: 15,
    paddingVertical: 11,
    maxWidth: "100%",
    borderWidth: 1,
  },
  bubbleBot: {
    borderBottomLeftRadius: 8,
  },
  bubbleUser: {
    borderBottomRightRadius: 8,
    alignSelf: "flex-end",
  },
  bubbleText: {
    fontSize: TYPE.body,
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
    paddingHorizontal: SPACING.md + 2,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm + 2,
    borderTopWidth: 0,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 4,
  },
  inputWrap: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    overflow: "hidden",
  },
  textInput: {
    paddingHorizontal: 15,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: TYPE.bodyLg,
    fontWeight: "600",
    fontFamily: Fonts.sans,
    textAlignVertical: "top",
    maxHeight: 110,
    minHeight: 46,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
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
