import { del, get, post, put } from './request';
import type { NotificationItem } from '../store/useNotificationStore';

export interface NotificationListResult {
  items: NotificationItem[];
  total: number;
  unreadCount: number;
}

export function getNotificationList(params?: { limit?: number }) {
  return get<NotificationListResult>('/notifications', params as Record<string, unknown>);
}

export function getUnreadNotificationCount() {
  return get<{ unreadCount: number }>('/notifications/unread-count');
}

export interface PublishNotificationParams {
  title: string;
  message: string;
  priority?: 'high' | 'medium' | 'low';
  targetRoles?: string[];
  targetUsernames?: string[];
}

export interface PublishNotificationResult {
  publishId: string;
  recipients: string[];
  delivered: number;
}

export function publishNotification(params: PublishNotificationParams) {
  return post<PublishNotificationResult>('/notifications/publish', params);
}

export interface PublishedNotificationRecipient {
  id: string;
  username: string;
  read: boolean;
  readAt: string | null;
  deleted: boolean;
  deletedAt: string | null;
}

export interface PublishedNotificationItem {
  id: string;
  title: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  sender: string;
  targetRoles: string[];
  targetUsernames: string[];
  timestamp: string;
  revokedAt: string | null;
  revokedBy: string | null;
  totalRecipients: number;
  readCount: number;
  unreadCount: number;
  deletedCount: number;
  recipients: PublishedNotificationRecipient[];
}

export interface PublishedNotificationListResult {
  items: PublishedNotificationItem[];
  total: number;
}

export function getPublishedNotifications(params?: { limit?: number }) {
  return get<PublishedNotificationListResult>(
    '/notifications/published',
    params as Record<string, unknown>,
  );
}

export function getPublishedNotification(id: string) {
  return get<PublishedNotificationItem>(`/notifications/published/${id}`);
}

export function revokePublishedNotification(id: string) {
  return put<{ publishId: string; updated: number; revokedAt: string }>(
    `/notifications/published/${id}/revoke`,
    {},
  );
}

export function markNotificationRead(id: string) {
  return put<{ id: string }>(`/notifications/${id}/read`, {});
}

export function markAllNotificationsRead() {
  return put<{ updated: number }>('/notifications/read-all', {});
}

export function deleteNotification(id: string) {
  return del<{ id: string }>(`/notifications/${id}`);
}

export function clearNotifications() {
  return del<{ deleted: number }>('/notifications');
}
