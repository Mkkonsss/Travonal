import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastMessage {
  id: string;
  text: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: ToastMessage | null;
  showToast: (text: string, type?: ToastType, action?: ToastAction) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: null,
  showToast: () => {},
  dismiss: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idRef = useRef(0);

  const dismiss = useCallback(() => {
    setToast(null);
  }, []);

  const showToast = useCallback(
    (text: string, type: ToastType = 'success', action?: ToastAction) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = String(++idRef.current);
      setToast({ id, text, type, action });
      timerRef.current = setTimeout(() => {
        setToast((prev) => (prev?.id === id ? null : prev));
      }, action ? 4500 : 3000);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast, showToast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
