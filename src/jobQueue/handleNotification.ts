import type { ConsumeMessage } from 'amqplib';
import type { Logger } from 'pino';
import type { Pool } from 'pg';
import { NotificationStatus } from '../notificationStatus.ts';
import z from 'zod';

// Dependencies are passed in so tests can swap in fakes. Only what the handler uses is required.
export interface HandlerDeps {
  pool: Pick<Pool, 'query'>;
  logger: Pick<Logger, 'info' | 'warn'>;
}

// Handles one queue message: its body is a notification id, which is marked as sent.
export function createMessageHandler({ pool, logger }: HandlerDeps) {
  return async function handleMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      logger.info('Empty message in the queue');
      return;
    }
    const notificationId = msg.content.toString();

    if (!z.uuid().safeParse(notificationId).success) {
      logger.warn(`notification uuid not provided, param = ${notificationId}`);
      return;
    }

    const { rows: notificationRows } = await pool.query(
      `SELECT channel, payload, user_id, status from notifications where id = $1`,
      [notificationId],
    );

    if (notificationRows.length !== 1) {
      logger.warn(`Couldn't find the notification with id = ${notificationId}`);
      return;
    }

    const notification = notificationRows[0];
    if (notification.status === NotificationStatus.Sent) {
      logger.info(`Notification already sent for id = ${notificationId}`);
      return;
    }

    logger.info(
      { notificationId, channel: notification.channel, userId: notification.user_id },
      'FAKE SEND',
    );

    const result = await pool.query(`UPDATE notifications SET status = $1 where id = $2`, [
      NotificationStatus.Sent,
      notificationId,
    ]);
    if (result.rowCount === 1) {
      logger.info({ notificationId }, 'notification marked sent');
    } else {
      logger.warn({ notificationId }, 'no notification row found to update');
    }
  };
}
