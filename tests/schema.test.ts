import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { config } from '../src/config.ts';

// Postgres error codes (https://www.postgresql.org/docs/current/errcodes-appendix.html)
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';
const RESTRICT_VIOLATION = '23001';

const client = new pg.Client({ connectionString: config.DATABASE_URL });

async function createUser(name = 'Test User'): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
    [name, `${crypto.randomUUID()}@example.com`],
  );
  return rows[0]!.id;
}

async function createNotification(userId: string, status = 'pending'): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO notifications (user_id, status) VALUES ($1, $2) RETURNING id',
    [userId, status],
  );
  return rows[0]!.id;
}

describe('database schema', () => {
  before(() => client.connect());
  after(() => client.end());

  // Every test runs in its own transaction that is rolled back, so no data is left behind.
  beforeEach(() => client.query('BEGIN'));
  afterEach(() => client.query('ROLLBACK'));

  describe('structure', () => {
    it('users.archived_at is a nullable timestamptz', async () => {
      const { rows } = await client.query(
        `SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'users' AND column_name = 'archived_at'`,
      );
      assert.deepEqual(rows, [{ data_type: 'timestamp with time zone', is_nullable: 'YES' }]);
    });

    it('notifications has indexes on status, created_at and user_id', async () => {
      const { rows } = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'notifications' ORDER BY indexname`,
      );
      const names = rows.map((r) => r.indexname);
      assert.ok(names.includes('notifications_status_index'));
      assert.ok(names.includes('notifications_created_at_index'));
      assert.ok(names.includes('notifications_user_id_index'));
    });

    it('notifications.user_id references users with ON DELETE RESTRICT', async () => {
      const { rows } = await client.query<{ confdeltype: string }>(
        `SELECT confdeltype FROM pg_constraint
         WHERE conrelid = 'notifications'::regclass AND contype = 'f'
           AND confrelid = 'users'::regclass`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.confdeltype, 'r'); // 'r' = RESTRICT
    });
  });

  describe('users', () => {
    it('a new user is active (archived_at is null)', async () => {
      const userId = await createUser();
      const { rows } = await client.query('SELECT archived_at FROM users WHERE id = $1', [userId]);
      assert.equal(rows[0].archived_at, null);
    });

    it('archiving a user sets archived_at', async () => {
      const userId = await createUser();
      await client.query('UPDATE users SET archived_at = now() WHERE id = $1', [userId]);
      const { rows } = await client.query('SELECT archived_at FROM users WHERE id = $1', [userId]);
      assert.ok(rows[0].archived_at instanceof Date);
    });
  });

  describe('notifications', () => {
    it('can be inserted for an existing user', async () => {
      const userId = await createUser();
      const id = await createNotification(userId, 'pending');
      const { rows } = await client.query('SELECT status FROM notifications WHERE id = $1', [id]);
      assert.equal(rows[0].status, 'pending');
    });

    it('rejects an unknown user_id (foreign key)', async () => {
      await assert.rejects(createNotification(crypto.randomUUID()), {
        code: FOREIGN_KEY_VIOLATION,
      });
    });

    it('rejects a missing status (NOT NULL)', async () => {
      const userId = await createUser();
      await assert.rejects(
        client.query('INSERT INTO notifications (user_id) VALUES ($1)', [userId]),
        { code: NOT_NULL_VIOLATION },
      );
    });

    it('blocks deleting a user who has notifications (RESTRICT)', async () => {
      const userId = await createUser();
      await createNotification(userId);
      await assert.rejects(client.query('DELETE FROM users WHERE id = $1', [userId]), {
        code: RESTRICT_VIOLATION,
      });
    });

    it('moves updated_at on update and leaves created_at alone', async () => {
      const userId = await createUser();
      // Backdate on insert: the trigger only fires on UPDATE.
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO notifications (user_id, status, created_at, updated_at)
         VALUES ($1, 'pending', '2000-01-01', '2000-01-01') RETURNING id`,
        [userId],
      );
      const id = inserted[0]!.id;

      await client.query(`UPDATE notifications SET status = 'sent' WHERE id = $1`, [id]);

      const { rows } = await client.query(
        'SELECT created_at, updated_at FROM notifications WHERE id = $1',
        [id],
      );
      assert.equal(rows[0].created_at.toISOString(), '2000-01-01T00:00:00.000Z');
      assert.ok(rows[0].updated_at > new Date('2000-01-01'));
    });
  });
});
