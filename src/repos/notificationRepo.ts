import type { Pool } from 'pg';
import { NotificationStatus, type NotificationRecord } from '../models/notification.ts';

// The operations the worker needs. The SQL lives here so callers use named operations, and tests can fake them.
export interface NotificationRepo {
  findById(id: string): Promise<NotificationRecord | null>;
  // Both return false when no row matched.
  markSent(id: string): Promise<boolean>;
  markFailed(id: string, error: string): Promise<boolean>;
}

export function createNotificationRepo(db: Pick<Pool, 'query'>): NotificationRepo {
  return {
    async findById(id) {
      const { rows } = await db.query(
        `SELECT id, channel, payload, user_id, status, attempts FROM notifications WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        channel: row.channel,
        payload: row.payload,
        userId: row.user_id,
        status: row.status,
        attempts: row.attempts,
      };
    },

    async markSent(id) {
      const result = await db.query(`UPDATE notifications SET status = $1 WHERE id = $2`, [
        NotificationStatus.Sent,
        id,
      ]);
      return result.rowCount === 1;
    },

    async markFailed(id, error) {
      const result = await db.query(
        `UPDATE notifications SET status = $1, last_error = $2, attempts = attempts + 1 WHERE id = $3`,
        [NotificationStatus.Failed, error, id],
      );
      return result.rowCount === 1;
    },
  };
}
