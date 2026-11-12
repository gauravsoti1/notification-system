import express, { type Request, type Response } from 'express';
import z from 'zod';
import { pool } from '../db.ts';
import { validateBody } from './validateBody.ts';
import { enqueue } from '../jobQueue/index.ts';

export const router = express.Router({ caseSensitive: true, strict: true });

export const payloadSchema = z.object({
  message: z.string(),
});

const postNotificationsSchema = z.object({
  user_id: z.uuid(),
  channel: z.enum(['email', 'sms', 'push']),
  payload: payloadSchema,
});

type PostNotificationsBody = z.infer<typeof postNotificationsSchema>;

router.post('/', validateBody(postNotificationsSchema), async (req: Request, res: Response) => {
  const { user_id, channel, payload } = req.body as PostNotificationsBody;

  // Selecting from users means an unknown or archived user inserts nothing (no rows returned).
  // The initial status and attempts are set here, not by database defaults.
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, channel, payload, status, attempts)
     SELECT id, $2::varchar, $3::jsonb, 'pending', 0
     FROM users
     WHERE id = $1 AND archived_at IS NULL
     RETURNING id, status, created_at`,
    [user_id, channel, payload],
  );

  if (rows.length === 0) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  enqueue(rows[0].id);

  res.status(202).json(rows[0]);
});
