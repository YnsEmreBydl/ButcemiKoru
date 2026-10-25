import { useRef, type ComponentRef } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetColors, BudgetRadius } from '@/constants/budget-theme';

import { BudgetIcon } from './budget-icon';

export type DemoNoticeContent = { title: string; description: string };

type DemoNoticeProps = {
  content: DemoNoticeContent | null;
  onClose: () => void;
};

export function DemoNotice({ content, onClose }: DemoNoticeProps) {
  const closeButton = useRef<ComponentRef<typeof View>>(null);

  return (
    <Modal
      visible={content !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => {
        if (Platform.OS === 'web') closeButton.current?.focus();
      }}>
      <SafeAreaView style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <ScrollView
            bounces={false}
            style={styles.dialogScroll}
            contentContainerStyle={styles.dialogContent}>
            <View style={styles.demoLabel}>
              <BudgetIcon name="info" size={16} color={BudgetColors.green} />
              <Text style={styles.demoLabelText}>DEMO ÖN İZLEMESİ</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {content?.title}
            </Text>
            <Text style={styles.description}>{content?.description}</Text>
            <Text style={styles.note}>Örnek veriler değişmez. Hiçbir bilgi kaydedilmez.</Text>
            <Pressable
              ref={closeButton}
              accessibilityRole="button"
              accessibilityLabel="Anladım, demo açıklamasını kapat"
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Text style={styles.closeButtonText}>Anladım</Text>
            </Pressable>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: BudgetColors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    borderRadius: BudgetRadius.card,
    backgroundColor: BudgetColors.surface,
    overflow: 'hidden'
  },
  dialogScroll: {
    flexGrow: 0,
    flexShrink: 1
  },
  dialogContent: {
    padding: 24,
    gap: 16
  },
  demoLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  demoLabelText: {
    color: BudgetColors.green,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
    flexShrink: 1
  },
  title: {
    color: BudgetColors.ink,
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '700'
  },
  description: {
    color: BudgetColors.secondary,
    fontSize: 15,
    lineHeight: 24
  },
  note: {
    color: BudgetColors.secondary,
    fontSize: 12,
    lineHeight: 19
  },
  closeButton: {
    minHeight: 52,
    borderRadius: BudgetRadius.small,
    backgroundColor: BudgetColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    marginTop: 4
  },
  closeButtonText: {
    color: BudgetColors.surface,
    fontSize: 15,
    fontWeight: '600'
  },
  pressed: {
    opacity: 0.8
  }
});
