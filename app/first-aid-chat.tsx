import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getBotResponse, getWelcomeMessage, Message, QUICK_TOPICS } from '@/utils/first-aid-chatbot';
import { useRouter } from 'expo-router';

// ─────────────────────────────────────────────────────────────────────────────
// Simple markdown-to-plain-text bold renderer (renders **text** in bold)
// ─────────────────────────────────────────────────────────────────────────────
function MarkdownText({ text, style, isDark }: { text: string; style?: object; isDark: boolean }) {
  // Split by **...** and render alternating plain/bold spans
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <ThemedText style={style}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <ThemedText key={i} style={[style, { fontWeight: '800' }]}>
            {part}
          </ThemedText>
        ) : (
          part
        )
      )}
    </ThemedText>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message bubble
// ─────────────────────────────────────────────────────────────────────────────
function MessageBubble({
  message,
  isDark,
  onFollowUp,
}: {
  message: Message;
  isDark: boolean;
  onFollowUp: (text: string) => void;
}) {
  const isBot = message.role === 'bot';

  return (
    <View style={[styles.bubbleRow, isBot ? styles.bubbleRowBot : styles.bubbleRowUser]}>
      {isBot && (
        <View style={[styles.avatar, { backgroundColor: '#DC2626' }]}>
          <MaterialIcons name="local-hospital" size={14} color="#fff" />
        </View>
      )}
      <View style={styles.bubbleContent}>
        <View
          style={[
            styles.bubble,
            isBot
              ? [styles.bubbleBot, isDark ? styles.bubbleBotDark : styles.bubbleBotLight]
              : [styles.bubbleUser, isDark ? styles.bubbleUserDark : styles.bubbleUserLight],
          ]}>
          <MarkdownText
            text={message.text}
            isDark={isDark}
            style={[
              styles.bubbleText,
              {
                color: isBot
                  ? isDark
                    ? '#E2E8F0'
                    : '#0F172A'
                  : '#FFFFFF',
                fontFamily: Fonts.sans,
              },
            ]}
          />
        </View>

        {/* Follow-up suggestions */}
        {isBot && message.role === 'bot' && message.followUps && message.followUps.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.followUpRow}>
            {message.followUps.map((fu) => (
              <Pressable
                key={fu}
                onPress={() => onFollowUp(fu)}
                style={({ pressed }) => [
                  styles.followUpChip,
                  isDark ? styles.followUpChipDark : styles.followUpChipLight,
                  pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
                ]}>
                <ThemedText style={[styles.followUpText, { color: isDark ? '#93C5FD' : '#1D4ED8' }]}>
                  {fu}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────────────────────────────────────────
function TypingIndicator({ isDark }: { isDark: boolean }) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -6, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600),
        ])
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

  const dotColor = isDark ? '#64748B' : '#94A3B8';

  return (
    <View style={[styles.bubbleRow, styles.bubbleRowBot]}>
      <View style={[styles.avatar, { backgroundColor: '#DC2626' }]}>
        <MaterialIcons name="local-hospital" size={14} color="#fff" />
      </View>
      <View style={[styles.bubble, styles.bubbleBot, isDark ? styles.bubbleBotDark : styles.bubbleBotLight, styles.typingBubble]}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[styles.typingDot, { backgroundColor: dotColor, transform: [{ translateY: dot }] }]}
          />
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main chat screen
// ─────────────────────────────────────────────────────────────────────────────
export default function FirstAidChatScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const colors = Colors[colorScheme];

  const [messages, setMessages] = useState<Message[]>([getWelcomeMessage()]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMsg: Message = { role: 'user', text: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInputText('');
      setIsTyping(true);
      scrollToBottom();

      // Short delay so the typing indicator flashes briefly (feels natural)
      setTimeout(() => {
        const botMsg = getBotResponse(trimmed);
        setMessages((prev) => [...prev, botMsg]);
        setIsTyping(false);
        scrollToBottom();
      }, 250);
    },
    [scrollToBottom]
  );

  const handleFollowUp = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage]
  );

  const handleQuickTopic = useCallback(
    (keywords: string[]) => {
      sendMessage(keywords[0]);
    },
    [sendMessage]
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: isDark ? '#0B1220' : '#FFFFFF',
            borderBottomColor: isDark ? '#1E2028' : '#EEF2F6',
          },
        ]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}>
          <MaterialIcons name="arrow-back" size={22} color={isDark ? '#E2E8F0' : '#0F172A'} />
        </Pressable>

        <View style={styles.headerCenter}>
          <View style={styles.headerIcon}>
            <MaterialIcons name="local-hospital" size={18} color="#fff" />
          </View>
          <View>
            <ThemedText style={styles.headerTitle}>First Aid Assistant</ThemedText>
            <ThemedText style={[styles.headerSub, { color: isDark ? '#64748B' : '#94A3B8' }]}>
              WHO Guidelines • Always online
            </ThemedText>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={[styles.onlineDot, { backgroundColor: '#10B981' }]} />
        </View>
      </View>

      {/* WHO disclaimer banner */}
      <View style={[styles.disclaimerBanner, { backgroundColor: isDark ? '#1C0A0A' : '#FEF2F2', borderColor: isDark ? '#7F1D1D' : '#FECACA' }]}>
        <MaterialIcons name="warning" size={14} color="#DC2626" />
        <ThemedText style={[styles.disclaimerText, { color: isDark ? '#FCA5A5' : '#B91C1C' }]}>
          Life-threatening emergency? Call 911 immediately. This chatbot provides guidance only.
        </ThemedText>
      </View>

      {/* Quick topic pills (shown only at start) */}
      {messages.length <= 1 && (
        <View style={[styles.quickTopicsWrap, { borderBottomColor: isDark ? '#1E2028' : '#EEF2F6' }]}>
          <ThemedText style={[styles.quickTopicsLabel, { color: isDark ? '#64748B' : '#94A3B8' }]}>
            Quick topics
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickTopicsScroll}>
            {QUICK_TOPICS.map((topic) => (
              <Pressable
                key={topic.id}
                onPress={() => handleQuickTopic(topic.keywords)}
                style={({ pressed }) => [
                  styles.quickTopicChip,
                  isDark ? styles.quickTopicChipDark : styles.quickTopicChipLight,
                  pressed && { opacity: 0.75, transform: [{ scale: 0.96 }] },
                ]}>
                <MaterialIcons
                  name={topic.icon as any}
                  size={14}
                  color={isDark ? '#F87171' : '#DC2626'}
                />
                <ThemedText style={[styles.quickTopicText, { color: isDark ? '#F87171' : '#DC2626' }]}>
                  {topic.label}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Message list */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <MessageBubble message={item} isDark={isDark} onFollowUp={handleFollowUp} />
          )}
          ListFooterComponent={isTyping ? <TypingIndicator isDark={isDark} /> : null}
          contentContainerStyle={[
            styles.messageList,
            { paddingBottom: 16 + insets.bottom },
          ]}
          onContentSizeChange={scrollToBottom}
          showsVerticalScrollIndicator={false}
        />

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              paddingBottom: Math.max(insets.bottom, 8) + 4,
              backgroundColor: isDark ? '#0B1220' : '#FFFFFF',
              borderTopColor: isDark ? '#1E2028' : '#EEF2F6',
            },
          ]}>
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: isDark ? '#1E2028' : '#F1F5F9',
                color: isDark ? '#E2E8F0' : '#0F172A',
                borderColor: isDark ? '#334155' : '#E2E8F0',
              },
            ]}
            placeholder="Ask about first aid..."
            placeholderTextColor={isDark ? '#475569' : '#94A3B8'}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={() => sendMessage(inputText)}
            returnKeyType="send"
            multiline
            maxLength={500}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || isTyping}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: inputText.trim() && !isTyping ? '#DC2626' : isDark ? '#1E2028' : '#E2E8F0' },
              pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] },
            ]}>
            <MaterialIcons
              name="send"
              size={18}
              color={inputText.trim() && !isTyping ? '#FFFFFF' : isDark ? '#475569' : '#94A3B8'}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: Fonts.sans,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: Fonts.sans,
    marginTop: 1,
  },
  headerRight: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  // Disclaimer
  disclaimerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  disclaimerText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Fonts.sans,
    flex: 1,
  },
  // Quick topics
  quickTopicsWrap: {
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  quickTopicsLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Fonts.sans,
    paddingHorizontal: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quickTopicsScroll: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  quickTopicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickTopicChipLight: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  quickTopicChipDark: {
    backgroundColor: '#1C0A0A',
    borderColor: '#7F1D1D',
  },
  quickTopicText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  // Messages
  messageList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  bubbleRowBot: {
    justifyContent: 'flex-start',
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubbleContent: {
    flex: 1,
    maxWidth: '88%',
    gap: 6,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '100%',
  },
  bubbleBot: {
    borderBottomLeftRadius: 4,
  },
  bubbleBotLight: {
    backgroundColor: '#F1F5F9',
  },
  bubbleBotDark: {
    backgroundColor: '#1E2028',
  },
  bubbleUser: {
    borderBottomRightRadius: 4,
    alignSelf: 'flex-end',
  },
  bubbleUserLight: {
    backgroundColor: '#DC2626',
  },
  bubbleUserDark: {
    backgroundColor: '#991B1B',
  },
  bubbleText: {
    fontSize: 13.5,
    lineHeight: 20,
  },
  // Follow-up chips
  followUpRow: {
    marginTop: 2,
  },
  followUpChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 6,
  },
  followUpChipLight: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  followUpChipDark: {
    backgroundColor: '#0C1A2E',
    borderColor: '#1E40AF',
  },
  followUpText: {
    fontSize: 11.5,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  // Typing indicator
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: 1,
  },
  textInput: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    fontFamily: Fonts.sans,
    maxHeight: 100,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
