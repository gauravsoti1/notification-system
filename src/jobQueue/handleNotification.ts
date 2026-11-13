import type { ConsumeMessage } from 'amqplib';
import type { Logger } from 'pino';
import z from 'zod';
import type { Channel, SendResult } from '../channels/types.ts';
import { NotificationStatus } from '../notificationStatus.ts';
import type { NotificationRecord, NotificationRepo } from '../notificationRepo.ts';

// Dependencies are passed in so tests can swap in fakes. Only what the handler uses is required.
export interface HandlerDeps {
  repo: NotificationRepo;
  logger: Pick<Logger, 'info' | 'warn'>;
  channel: Channel;
}

// Handles one queue message: its body is a notification id, which is sent through the injected channel and marked sent (or failed).
export function createMessageHandler({ repo, logger, channel }: HandlerDeps) {
  // Returns the notification to send, or null after logging why there is nothing to do.
  async function loadNotificationToSend(
    msg: ConsumeMessage | null,
  ): Promise<NotificationRecord | null> {
    if (!msg) {
      logger.info('Empty message in the queue');
      return null;
    }
    const notificationId = msg.content.toString();

    if (!z.uuid().safeParse(notificationId).success) {
      logger.warn(`notification uuid not provided, param = ${notificationId}`);
      return null;
    }

    const record = await repo.findById(notificationId);
    if (!record) {
      logger.warn(`Couldn't find the notification with id = ${notificationId}`);
      return null;
    }

    if (record.status === NotificationStatus.Sent) {
      logger.info(`Notification already sent for id = ${notificationId}`);
      return null;
    }

    return record;
  }

  // Records the outcome of a send on the row and logs it.
  async function recordResult(notificationId: string, sendResult: SendResult): Promise<void> {
    if (!sendResult.ok) {
      // Retries are a later ticket; for now record the failure on the row.
      logger.warn(
        { notificationId, retryable: sendResult.retryable, error: sendResult.error },
        'send failed',
      );
      await repo.markFailed(notificationId, sendResult.error);
      return;
    }

    if (await repo.markSent(notificationId)) {
      logger.info({ notificationId }, 'notification marked sent');
    } else {
      logger.warn({ notificationId }, 'no notification row found to update');
    }
  }

  return async function handleMessage(msg: ConsumeMessage | null): Promise<void> {
    const record = await loadNotificationToSend(msg);
    if (!record) return;

    const sendResult = await channel.send({
      id: record.id,
      channel: record.channel,
      payload: record.payload,
      userId: record.userId,
    });
    await recordResult(record.id, sendResult);
  };
}
