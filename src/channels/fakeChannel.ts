import type { Logger } from 'pino';
import type { Channel, Notification, SendResult } from './types.ts';

export interface FakeChannelOptions {
  // Probability (0 to 1) that a send fails. 0 never fails, 1 always fails.
  failureRate?: number;
  // Whether a forced failure is marked retryable.
  retryable?: boolean;
  // Replaceable so tests can control the outcome.
  random?: () => number;
  logger?: Pick<Logger, 'info'>;
}

// A stand-in for a real provider: logs the send and can be told to fail.
export class FakeChannel implements Channel {
  private readonly failureRate: number;
  private readonly retryable: boolean;
  private readonly random: () => number;
  private readonly logger?: Pick<Logger, 'info'>;

  constructor({
    failureRate = 0,
    retryable = true,
    random = Math.random,
    logger,
  }: FakeChannelOptions = {}) {
    this.failureRate = failureRate;
    this.retryable = retryable;
    this.random = random;
    this.logger = logger;
  }

  async send(notification: Notification): Promise<SendResult> {
    if (this.random() < this.failureRate) {
      return { ok: false, retryable: this.retryable, error: 'FakeChannel forced failure' };
    }
    this.logger?.info(
      {
        notificationId: notification.id,
        channel: notification.channel,
        userId: notification.userId,
      },
      'FAKE SEND',
    );
    return { ok: true };
  }
}
