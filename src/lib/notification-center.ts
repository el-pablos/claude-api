import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Notification, NotificationType } from "./types";

const MAX_NOTIFICATIONS = 100;

const notifications: Notification[] = [];
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function addNotification(
  type: NotificationType,
  title: string,
  message: string,
): Notification {
  const notification: Notification = {
    id: randomUUID(),
    type,
    title,
    message,
    timestamp: Date.now(),
    read: false,
  };

  notifications.unshift(notification);
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.length = MAX_NOTIFICATIONS;
  }

  emitter.emit("notification", notification);
  return notification;
}

export interface NotificationsResult {
  notifications: Notification[];
  unreadCount: number;
}

export function getNotifications(): NotificationsResult {
  const unreadCount = notifications.filter((n) => !n.read).length;
  return {
    notifications: [...notifications],
    unreadCount,
  };
}

export function markRead(id: string): boolean {
  const notification = notifications.find((n) => n.id === id);
  if (!notification) return false;
  notification.read = true;
  return true;
}

export function markAllRead(): number {
  let count = 0;
  for (const notification of notifications) {
    if (!notification.read) {
      notification.read = true;
      count += 1;
    }
  }
  return count;
}

export function deleteNotification(id: string): boolean {
  const idx = notifications.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notifications.splice(idx, 1);
  return true;
}

export function clearAll(): number {
  const count = notifications.length;
  notifications.length = 0;
  return count;
}

export function onNotification(
  listener: (notification: Notification) => void,
): () => void {
  emitter.on("notification", listener);
  return () => {
    emitter.off("notification", listener);
  };
}
