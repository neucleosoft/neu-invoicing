import { createContext, useContext, useState, useCallback, useRef } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.toast;
}

const TOAST_STYLES: Record<ToastType, { accent: string; icon: typeof CheckCircle2; iconColor: string }> = {
  success: {
    accent: "border-green-500/40 bg-green-50 dark:bg-green-900/20 dark:border-green-500/40",
    icon: CheckCircle2,
    iconColor: "text-green-600 dark:text-green-400",
  },
  error: {
    accent: "border-red-500/40 bg-red-50 dark:bg-red-900/20 dark:border-red-500/40",
    icon: XCircle,
    iconColor: "text-red-600 dark:text-red-400",
  },
  info: {
    accent: "border-primary-500/40 bg-primary-50 dark:bg-primary-900/20 dark:border-primary-500/40",
    icon: Info,
    iconColor: "text-primary-600 dark:text-primary-400",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const toast = {
    success: (msg: string) => addToast(msg, "success"),
    error: (msg: string) => addToast(msg, "error"),
    info: (msg: string) => addToast(msg, "info"),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const { accent, icon: Icon, iconColor } = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className={`${accent} border backdrop-blur-sm text-gray-900 dark:text-gray-100 pl-3 pr-2 py-3 rounded-xl shadow-lg flex items-start gap-3 min-w-[280px] max-w-[420px] pointer-events-auto animate-slide-in`}
              role="status"
            >
              <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
              <span className="text-sm flex-1 leading-5">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
