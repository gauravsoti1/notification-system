// "Channel" here is the notification channel (email, sms, push), not an AMQP channel.

import type { Notification } from '../models/notification.ts';

// A failure says whether trying again could help (e.g. a timeout) or not (e.g. a rejected address).
export type SendResult = { ok: true } | { ok: false; retryable: boolean; error: string };

export interface Channel {
  send(notification: Notification): Promise<SendResult>;
}
