/**
 * ModalContext — Global modal state management
 * Use `useModal()` hook in any component to show alerts/confirmations
 */
import React, { createContext, useCallback, useContext, useState } from "react";
import { Alert } from "react-native";

interface ModalContextValue {
  showAlert: (title: string, message: string, onConfirm?: () => void) => void;
  showConfirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
  ) => void;
  showError: (title: string, message: string, onConfirm?: () => void) => void;
  showSuccess: (title: string, message: string, onConfirm?: () => void) => void;
  hideModal: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [, setModalVisible] = useState(false);
  const lastModalRef = React.useRef<{ key: string; at: number } | null>(null);

  const shouldSuppressDuplicate = useCallback((next: { type?: string; title?: string; message: string }) => {
    const now = Date.now();
    const key = `${next.type || "alert"}::${next.title || ""}::${next.message}`;
    if (lastModalRef.current && lastModalRef.current.key === key && now - lastModalRef.current.at < 1500) {
      return true;
    }
    lastModalRef.current = { key, at: now };
    return false;
  }, []);

  const hideModal = useCallback(() => {
    setModalVisible(false);
  }, []);

  const showAlert = useCallback(
    (title: string, message: string, onConfirm?: () => void) => {
      if (shouldSuppressDuplicate({ type: "alert", title, message })) return;
      Alert.alert(title, message, [
        {
          text: "OK",
          onPress: () => {
            hideModal();
            if (onConfirm) onConfirm();
          },
        },
      ]);
    },
    [hideModal, shouldSuppressDuplicate],
  );

  const showConfirm = useCallback(
    (
      title: string,
      message: string,
      onConfirm: () => void,
      onCancel?: () => void,
    ) => {
      if (shouldSuppressDuplicate({ type: "confirm", title, message })) return;
      Alert.alert(title, message, [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            hideModal();
            if (onCancel) onCancel();
          },
        },
        {
          text: "OK",
          onPress: () => {
            hideModal();
            onConfirm();
          },
        },
      ]);
    },
    [hideModal, shouldSuppressDuplicate],
  );

  const showError = useCallback(
    (title: string, message: string, onConfirm?: () => void) => {
      if (shouldSuppressDuplicate({ type: "alert", title, message })) return;
      Alert.alert(title, message, [
        {
          text: "OK",
          onPress: () => {
            hideModal();
            if (onConfirm) onConfirm();
          },
        },
      ]);
    },
    [hideModal, shouldSuppressDuplicate],
  );

  const showSuccess = useCallback(
    (title: string, message: string, onConfirm?: () => void) => {
      if (shouldSuppressDuplicate({ type: "alert", title, message })) return;
      Alert.alert(title, message, [
        {
          text: "OK",
          onPress: () => {
            hideModal();
            if (onConfirm) onConfirm();
          },
        },
      ]);
    },
    [hideModal, shouldSuppressDuplicate],
  );

  return (
    <ModalContext.Provider
      value={{ showAlert, showConfirm, showError, showSuccess, hideModal }}
    >
      {children}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used within ModalProvider");
  }
  return context;
}
