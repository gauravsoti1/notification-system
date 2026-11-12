// A const object plus a derived type (not a TS `enum`) works with Node's type stripping.
export const NotificationStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Failed: 'failed',
} as const;

export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];
