// "Channel" here is the notification channel (email, sms, push), not an AMQP channel.

// What a channel needs in order to send: the loaded notification row.
export interface Notification {
  id: string;
  channel: string;
  payload: unknown;
  userId: string;
}

// A failure says whether trying again could help (e.g. a timeout) or not (e.g. a rejected address).
export type SendResult = { ok: true } | { ok: false; retryable: boolean; error: string };

export interface Channel {
  send(notification: Notification): Promise<SendResult>;
}
