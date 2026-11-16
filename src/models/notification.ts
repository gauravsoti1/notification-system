// What a channel needs in order to send: the loaded notification row.
export interface Notification {
  id: string;
  channel: string;
  payload: unknown;
  userId: string;
}

// A stored notification: what a channel needs to send, plus where it is in its lifecycle.
export type NotificationRecord = Notification & { status: string; attempts: number };

// A const object plus a derived type (not a TS `enum`) works with Node's type stripping.
export const NotificationStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Failed: 'failed',
} as const;

export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];
