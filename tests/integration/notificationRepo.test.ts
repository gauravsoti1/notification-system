import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { config } from '../../src/envConfig.ts';
import { createNotificationRepo } from '../../src/notificationRepo.ts';
import { NotificationStatus } from '../../src/notificationStatus.ts';

// Runs the repo's SQL against the real Compose Postgres. Each test is rolled back.
const client = new pg.Client({ connectionString: config.DATABASE_URL });
const repo = createNotificationRepo(client);

async function createNotification(): Promise<{ id: string; userId: string }> {
  const user = await client.query<{ id: string }>(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
    ['Repo Test', `${crypto.randomUUID()}@example.com`],
  );
  const userId = user.rows[0]!.id;
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO notifications (user_id, channel, payload, status, attempts) VALUES ($1, $2, $3, $4, 0) RETURNING id',
    [userId, 'email', { message: 'hi' }, NotificationStatus.Pending],
  );
  return { id: rows[0]!.id, userId };
}

describe('notification repo', () => {
  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(() => client.query('BEGIN'));
  afterEach(() => client.query('ROLLBACK'));

  it('findById returns the notification with camelCase fields', async () => {
    const { id, userId } = await createNotification();

    expect(await repo.findById(id)).toEqual({
      id,
      channel: 'email',
      payload: { message: 'hi' },
      userId,
      status: NotificationStatus.Pending,
    });
  });

  it('findById returns null for an unknown id', async () => {
    expect(await repo.findById(crypto.randomUUID())).toBeNull();
  });

  it('markSent sets the status to sent', async () => {
    const { id } = await createNotification();

    expect(await repo.markSent(id)).toBe(true);
    expect((await repo.findById(id))?.status).toBe(NotificationStatus.Sent);
  });

  it('markFailed sets the status, records the error and counts the attempt', async () => {
    const { id } = await createNotification();

    expect(await repo.markFailed(id, 'provider timeout')).toBe(true);

    const { rows } = await client.query(
      'SELECT status, last_error, attempts FROM notifications WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      status: NotificationStatus.Failed,
      last_error: 'provider timeout',
      attempts: 1,
    });
  });

  it('markSent and markFailed return false when no row matches', async () => {
    const unknown = crypto.randomUUID();

    expect(await repo.markSent(unknown)).toBe(false);
    expect(await repo.markFailed(unknown, 'x')).toBe(false);
  });
});
