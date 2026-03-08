/**
 * FirstAidFab — floating ambulance FAB + inline professional chat widget.
 * DB-integrated via chat_history table.
 */
import { useAppState } from '@/components/app-state';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addChatMessage } from '@/utils/chat';
import { getFirstAidAiResponse } from '@/utils/first-aid-ai';
import { getBotResponse, type Message as ChatKbMessage } from '@/utils/first-aid-chatbot';
import { LANG_LABELS, UI, type Lang } from '@/utils/i18n-first-aid';
import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const BOX_W = Math.min(SCREEN_W - 32, 360);
const BOX_H = Math.min(SCREEN_H * 0.55, 480);

const LANGS: Lang[] = ['en', 'am', 'om'];



function RichText({ text, color, size = 14 }: { text: string; color: string; size?: number }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <Text style={{ color, fontSize: size, lineHeight: size * 1.55 }}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={{ fontWeight: '800', color }}>
            {p}
          </Text>
        ) : (
          p
        )
      )}
    </Text>
  );
}

interface Msg {
  role: 'bot' | 'user';
  text: string;
  followUps?: string[];
}

export function FirstAidFab() {
  const { isRegistered, user } = useAppState();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';

  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);
  const fabScale = useRef(new Animated.Value(1)).current;

  // ── Colors ──
  const surface = isDark ? '#111827' : '#FFFFFF';
  const headerBg = isDark ? '#1F2937' : '#FFFFFF';
  const borderClr = isDark ? '#374151' : '#E5E7EB';
  const txt = isDark ? '#F3F4F6' : '#111827';
  const muted = isDark ? '#6B7280' : '#9CA3AF';
  const inputBg = isDark ? '#1F2937' : '#F9FAFB';
  const accent = '#DC2626';
  const userBubbleBg = '#DC2626';
  const botBubbleBg = isDark ? '#1F2937' : '#F3F4F6';

  const scrollEnd = () =>
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      const userMsg: Msg = { role: 'user', text: t };
      const historyForReply: ChatKbMessage[] = [...messages, userMsg].map((m) => ({
        role: m.role,
        text: m.text,
      }));

      setMessages((p) => [...p, userMsg]);
      setInput('');
      setTyping(true);
      scrollEnd();

      const aiReply = await getFirstAidAiResponse(t, historyForReply, lang);
      const bot = (aiReply ?? getBotResponse(t, lang)) as Msg;

      setMessages((p) => [...p, bot]);
      setTyping(false);
      scrollEnd();

      if (user?.id) {
        await addChatMessage(user.id, user.id, t, bot.text).catch(() => {});
      }
    },
    [messages, user, lang]
  );

  const toggleOpen = useCallback(() => {
    Animated.sequence([
      Animated.timing(fabScale, {
        toValue: 0.85,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(fabScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
    setOpen((o) => !o);
  }, [fabScale]);

  if (!isRegistered) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { bottom: Math.max(insets.bottom, 10) + 66, right: 16 }]}
    >
      {/* ── CHAT BOX ── */}
      {open && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'position' : undefined}
          style={{ marginBottom: 12 }}
        >
          <View
            style={[
              styles.box,
              {
                width: BOX_W,
                maxHeight: BOX_H,
                backgroundColor: surface,
                borderColor: borderClr,
                shadowColor: isDark ? '#000' : '#6B7280',
              },
            ]}
          >
            {/* ── Header ── */}
            <View
              style={[styles.header, { backgroundColor: headerBg, borderBottomColor: borderClr }]}
            >
              <View style={styles.headerLeft}>
                <View style={styles.headerBadge}>
                  <Text style={{ fontSize: 16 }}>🚑</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.headerTitle, { color: txt }]}>
                    {UI[lang].headerTitle}
                  </Text>
                  <View style={styles.statusRow}>
                    <View style={styles.statusDot} />
                    <Text style={[styles.headerStatus, { color: muted }]}>
                      {UI[lang].headerStatus}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.headerRight}>
                {/* Language switcher */}
                <View style={styles.langRow}>
                  {LANGS.map((l) => (
                    <Pressable
                      key={l}
                      onPress={() => {
                        if (l !== lang) {
                          setLang(l);
                          setMessages([]);
                        }
                      }}
                      style={[
                        styles.langBtn,
                        {
                          backgroundColor:
                            l === lang ? accent : isDark ? '#374151' : '#F3F4F6',
                          borderColor: l === lang ? accent : borderClr,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.langText,
                          { color: l === lang ? '#fff' : muted },
                        ]}
                      >
                        {LANG_LABELS[l]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  onPress={() => setOpen(false)}
                  hitSlop={16}
                  style={[
                    styles.closeBtn,
                    { backgroundColor: isDark ? '#374151' : '#F3F4F6' },
                  ]}
                >
                  <Text style={[styles.closeIcon, { color: muted }]}>✕</Text>
                </Pressable>
              </View>
            </View>

            {/* ── Messages ── */}
            <FlatList<Msg>
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => String(i)}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={item.role === 'bot' ? styles.rowBot : styles.rowUser}>
                  {item.role === 'bot' && (
                    <View style={styles.msgAvatar}>
                      <Text style={{ fontSize: 10 }}>🏥</Text>
                    </View>
                  )}
                  <View
                    style={[
                      styles.bubble,
                      item.role === 'bot'
                        ? {
                            backgroundColor: botBubbleBg,
                            borderColor: borderClr,
                            borderWidth: 1,
                            borderBottomLeftRadius: 4,
                          }
                        : {
                            backgroundColor: userBubbleBg,
                            borderBottomRightRadius: 4,
                          },
                    ]}
                  >
                    <RichText
                      text={item.text}
                      color={item.role === 'user' ? '#fff' : txt}
                      size={13.5}
                    />
                  </View>

                </View>
              )}
              ListFooterComponent={
                typing ? (
                  <View style={styles.rowBot}>
                    <View style={styles.msgAvatar}>
                      <Text style={{ fontSize: 10 }}>🏥</Text>
                    </View>
                    <View
                      style={[
                        styles.bubble,
                        {
                          backgroundColor: botBubbleBg,
                          borderColor: borderClr,
                          borderWidth: 1,
                          paddingVertical: 12,
                          paddingHorizontal: 20,
                        },
                      ]}
                    >
                      <View style={styles.typingRow}>
                        <View style={[styles.dot, { backgroundColor: muted }]} />
                        <View
                          style={[styles.dot, { backgroundColor: muted, opacity: 0.7 }]}
                        />
                        <View
                          style={[styles.dot, { backgroundColor: muted, opacity: 0.4 }]}
                        />
                      </View>
                    </View>
                  </View>
                ) : null
              }
            />

            {/* ── Input bar ── */}
            <View
              style={[styles.inputBar, { borderTopColor: borderClr, backgroundColor: headerBg }]}
            >
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: inputBg,
                    color: txt,
                    borderColor: borderClr,
                  },
                ]}
                placeholder={UI[lang].inputPlaceholder}
                placeholderTextColor={muted}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                blurOnSubmit={false}
                maxLength={300}
                multiline
              />
              <Pressable
                onPress={() => send(input)}
                disabled={!input.trim() || typing}
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor:
                      input.trim() && !typing
                        ? accent
                        : isDark
                          ? '#374151'
                          : '#E5E7EB',
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text
                  style={{
                    fontSize: 16,
                    color: input.trim() && !typing ? '#fff' : muted,
                    fontWeight: '700',
                  }}
                >
                  ➤
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* ── FAB ── */}
      <Animated.View style={{ transform: [{ scale: fabScale }] }}>
        <Pressable onPress={toggleOpen} style={styles.fab}>
          <Text style={styles.fabEmoji}>🚑</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    alignItems: 'flex-end',
  },

  // ── Chat box ──
  box: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.15,
    shadowRadius: 32,
    elevation: 20,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  headerStatus: {
    fontSize: 11,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  langRow: {
    flexDirection: 'row',
    gap: 4,
  },
  langBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  langText: {
    fontSize: 10,
    fontWeight: '800',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Messages ──
  list: {
    maxHeight: 300,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  rowBot: {
    alignItems: 'flex-start',
    gap: 4,
  },
  rowUser: {
    alignItems: 'flex-end',
  },
  msgAvatar: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '92%',
  },



  // ── Typing ──
  typingRow: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  // ── Input bar ──
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    minHeight: 40,
    maxHeight: 80,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },

  // ── FAB ──
  fab: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  fabEmoji: {
    fontSize: 26,
  },
});
