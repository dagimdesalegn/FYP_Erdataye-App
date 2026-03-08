/**
 * ModalContext — Global modal state management
 * Use `useModal()` hook in any component to show alerts/confirmations
 */
import React, { createContext, useCallback, useContext, useState } from "react";
import { CustomModal, CustomModalProps } from "./custom-modal";

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
  const [modalProps, setModalProps] = useState<
    Omit<CustomModalProps, "visible"> & { visible: boolean }
  >({
    visible: false,
    message: "",
  });

  const hideModal = useCallback(() => {
    setModalProps((prev) => ({ ...prev, visible: false }));
  }, []);

  const showAlert = useCallback(
    (title: string, message: string, onConfirm?: () => void) => {
      setModalProps({
        visible: true,
        type: "alert",
        title,
        message,
        onConfirm: () => {
          hideModal();
          if (onConfirm) onConfirm();
        },
      });
    },
    [hideModal],
  );

  const showConfirm = useCallback(
    (
      title: string,
      message: string,
      onConfirm: () => void,
      onCancel?: () => void,
    ) => {
      setModalProps({
        visible: true,
        type: "confirm",
        title,
        message,
        onConfirm: () => {
          hideModal();
          onConfirm();
        },
        onCancel: () => {
          hideModal();
          if (onCancel) onCancel();
        },
      });
    },
    [hideModal],
  );

  const showError = useCallback(
    (title: string, message: string, onConfirm?: () => void) => {
      setModalProps({
        visible: true,
        type: "alert",
        title,
        message,
        icon: "error",
        iconColor: "#DC2626",
        onConfirm: () => {
          hideModal();
          if (onConfirm) onConfirm();
        },
      });
    },
    [hideModal],
  );

  const showSuccess = useCallback(
    (title: string, message: string, onConfirm?: () => void) => {
      setModalProps({
        visible: true,
        type: "alert",
        title,
        message,
        icon: "check-circle",
        iconColor: "#059669",
        onConfirm: () => {
          hideModal();
          if (onConfirm) onConfirm();
        },
      });
    },
    [hideModal],
  );

  return (
    <ModalContext.Provider
      value={{ showAlert, showConfirm, showError, showSuccess, hideModal }}
    >
      {children}
      <CustomModal {...modalProps} />
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
