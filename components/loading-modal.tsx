import React from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';

interface LoadingModalProps {
  visible: boolean;
  message?: string;
  colorScheme?: 'light' | 'dark';
}

export const LoadingModal = ({ 
  visible, 
  message = 'Creating your account...', 
  colorScheme = 'light' 
}: LoadingModalProps) => {
  const isDark = colorScheme === 'dark';
  const bgColor = isDark ? '#0F172A' : '#FFFFFF';
  const textColor = isDark ? '#ECEDEE' : '#0F172A';
  const subTextColor = isDark ? '#94A3B8' : '#64748B';

  if (!visible) return null;

  const content = (
    <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <ActivityIndicator size="large" color="#EF4444" style={styles.indicator} />

        {/* Message */}
        <ThemedText style={[styles.message, { color: textColor }]}>
          {message}
        </ThemedText>

        {/* Loading Progress Text */}
        <ThemedText style={[styles.progressText, { color: subTextColor }]}>
          Please wait while we set up your account...
        </ThemedText>
      </View>
    </View>
  );

  // On web, <Modal> has z-index/scroll issues — use absolute overlay instead
  if (Platform.OS === 'web') {
    return <View style={[StyleSheet.absoluteFill, { pointerEvents: 'auto' }]}>{content}</View>;
  }

  return (
    <Modal visible transparent statusBarTranslucent>
      {content}
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: 280,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
  },
  indicator: { marginBottom: 16 },
  message: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  progressText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.7,
    fontWeight: '500',
  },
});
