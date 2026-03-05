/**
 * FirstAidFab — floating ambulance FAB + inline elite chat widget.
 * No separate screen. DB-integrated via chat_history table.
 */
import { useAppState } from '@/components/app-state';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addChatMessage } from '@/utils/chat';
import { getBotResponse, getWelcomeMessage } from '@/utils/first-aid-chatbot';
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

const W = Math.min(Dimensions.get('window').width * 0.82, 310);
const SCREEN_H = Dimensions.get('window').height;

// Minimal welcome shown inside the widget
const WELCOME: Msg = {
  role: 'bot',
  text: 'Hi! I\'m your **First Aid Assistant** powered by WHO guidelines.\n\nAsk me anything — CPR, bleeding, stroke, burns, poisoning and more.',
};

function BoldText({ text, color, size = 12.5 }: { text: string; color: string; size?: number }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <Text style={{ color, fontSize: size, lineHeight: size * 1.5, flexWrap: 'wrap' }}>
      {parts.map((p, i) =>
        i % 2 === 1 ? <Text key={i} style={{ fontWeight: '800', color }}>{p}</Text> : p
      )}
    </Text>
  );
}

interface Msg { role: 'bot' | 'user'; text: string; followUps?: string[] }

export function FirstAidFab() {
  const { isRegistered, user } = useAppState();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef<FlatList>(null);
  const fabScale = useRef(new Animated.Value(1)).current;

  if (!isRegistered) return null;

  // ── palette ─────────────────────────────────────────────────────────────
  const surface   = isDark ? '#0D1117' : '#FFFFFF';
  const surfaceEl = isDark ? '#161B22' : '#F8FAFF';   // elevated surface
  const border    = isDark ? '#21262D' : '#E8ECF4';
  const accent    = '#E53E3E';                          // rich red
  const accentDim = isDark ? '#4A0E0E' : '#FFF0F0';
  const txt       = isDark ? '#CDD9E5' : '#1A202C';
  const sub       = isDark ? '#6E8098' : '#8896A5';
  const inputBg   = isDark ? '#161B22' : '#F0F4F8';
  const userBubble = accent;
  const botBubble  = surfaceEl;

  const scrollEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setMessages(p => [...p, { role: 'user', text: t }]);
    setInput('');
    setTyping(true);
    scrollEnd();
    setTimeout(async () => {
      const bot = getBotResponse(t) as Msg;
      setMessages(p => [...p, bot]);
      setTyping(false);
      scrollEnd();
      if (user?.id) {
        await addChatMessage(user.id, user.id, t, bot.text).catch(() => {});
      }
    }, 220);
  }, [user]);

  const toggleOpen = () => {
    Animated.sequence([
      Animated.timing(fabScale, { toValue: 0.85, duration: 70, useNativeDriver: true }),
      Animated.spring(fabScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
    setOpen(o => !o);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { bottom: Math.max(insets.bottom, 10) + 66, right: 14 }]}>

      {/* ── CHAT BOX ─────────────────────────────────────────── */}
      {open && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'position' : undefined}
          style={{ marginBottom: 10 }}>
          <View style={[styles.box, {
            width: W,
            maxHeight: SCREEN_H * 0.5,
            backgroundColor: surface,
            borderColor: border,
            shadowColor: isDark ? '#000' : '#2D3748',
          }]}>

            {/* ── Header ── */}
            <View style={[styles.hdr, { borderBottomColor: border, backgroundColor: surfaceEl }]}>
              <View style={styles.hdrLeft}>
                <View style={[styles.hdrBadge, { backgroundColor: accent }]}>
                  <Text style={{ fontSize: 13 }}>🚑</Text>
                </View>
                <View>
                  <Text style={[styles.hdrTitle, { color: txt }]}>First Aid</Text>
                  <View style={styles.hdrStatusRow}>
                    <View style={[styles.onlineDot, { backgroundColor: '#38A169' }]} />
                    <Text style={[styles.hdrStatus, { color: sub }]}>WHO · Always ready</Text>
                  </View>
                </View>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={16} style={styles.closeBtn}>
                <Text style={[styles.closeX, { color: sub }]}>✕</Text>
              </Pressable>
            </View>

            {/* ── Message list ── */}
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => String(i)}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={item.role === 'bot' ? styles.rowBot : styles.rowUser}>
                  <View style={[
                    styles.bubble,
                    item.role === 'bot'
                      ? [styles.bBot, { backgroundColor: botBubble, borderColor: border }]
                      : [styles.bUser, { backgroundColor: userBubble }],
                  ]}>
                    <BoldText
                      text={item.text}
                      color={item.role === 'user' ? '#fff' : txt}
                    />
                  </View>
                  {item.role === 'bot' && item.followUps?.length ? (
                    <View style={styles.fuWrap}>
                      {item.followUps.map(fu => (
                        <Pressable
                          key={fu}
                          onPress={() => send(fu)}
                          style={[styles.fuChip, {
                            backgroundColor: accentDim,
                            borderColor: isDark ? '#7F1D1D' : '#FECACA',
                          }]}>
                          <Text style={[styles.fuTxt, { color: accent }]}>{fu}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              )}
              ListFooterComponent={typing ? (
                <View style={styles.rowBot}>
                  <View style={[styles.bubble, styles.bBot, {
                    backgroundColor: botBubble, borderColor: border, paddingVertical: 10,
                  }]}>
                    <Text style={{ color: sub, fontSize: 18, letterSpacing: 5 }}>···</Text>
                  </View>
                </View>
              ) : null}
            />

            {/* ── Input bar ── */}
            <View style={[styles.inputBar, { borderTopColor: border, backgroundColor: surfaceEl }]}>
              <TextInput
                style={[styles.input, { backgroundColor: inputBg, color: txt }]}
                placeholder="Ask about first aid…"
                placeholderTextColor={sub}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                blurOnSubmit={false}
                maxLength={300}
              />
              <Pressable
                onPress={() => send(input)}
                disabled={!input.trim() || typing}
                style={[styles.sendBtn, {
                  backgroundColor: input.trim() && !typing ? accent : (isDark ? '#21262D' : '#E8ECF4'),
                }]}>
                <Text style={{ fontSize: 13, color: input.trim() && !typing ? '#fff' : sub, fontWeight: '700' }}>➤</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* ── FAB ─────────────────────────────────────────────── */}
      <Animated.View style={{ transform: [{ scale: fabScale }] }}>
        <Pressable onPress={toggleOpen} style={styles.fab}>
          <Text style={styles.fabIcon}>🚑</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', alignItems: 'flex-end' },

  // Chat box
  box: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 14,
  },

  // Header
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  hdrLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  hdrBadge: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  hdrTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.1 },
  hdrStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  hdrStatus: { fontSize: 10, fontWeight: '500' },
  closeBtn: { padding: 2 },
  closeX: { fontSize: 13, fontWeight: '700' },

  // Messages
  list: { maxHeight: 240 },
  listContent: { paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  rowBot: { alignItems: 'flex-start' },
  rowUser: { alignItems: 'flex-end' },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 8,
    maxWidth: '90%',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  bBot: { borderBottomLeftRadius: 3 },
  bUser: { borderBottomRightRadius: 3, borderColor: 'transparent' },

  // Follow-ups
  fuWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5, paddingLeft: 2 },
  fuChip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  fuTxt: { fontSize: 10, fontWeight: '700' },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderTopWidth: 1,
    gap: 6,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 7,
    fontSize: 12.5,
    minHeight: 34,
    maxHeight: 68,
  },
  sendBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },

  // FAB
  fab: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: '#E53E3E',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#E53E3E',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  fabIcon: { fontSize: 24 },
});
