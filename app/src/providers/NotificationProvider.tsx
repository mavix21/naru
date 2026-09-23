"use client";

import { createContext, type ReactNode } from "react";
import { toast } from "sonner";

type NotificationType =
  | "primary"
  | "secondary"
  | "success"
  | "error"
  | "warning";

interface NotificationContextType {
  addNotification: (message: string, type: NotificationType) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const addNotification = (message: string, type: NotificationType) => {
    if (type === "success") toast.success(message);
    else if (type === "error") toast.error(message);
    else if (type === "warning") toast.warning(message);
    else toast(message);
  };

  return (
    <NotificationContext value={{ addNotification }}>
      {children}
    </NotificationContext>
  );
}

export { NotificationContext };

export type { NotificationContextType };
