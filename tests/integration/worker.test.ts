import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, it } from 'vitest';
import amqb, { type Channel, type ChannelModel } from 'amqplib';
import pg from 'pg';
import { config } from '../../src/envConfig.ts';
import { emailQueue, queueOptions } from '../../src/jobQueue/config.ts';
import { NotificationStatus } from '../../src/notificationStatus.ts';

// End-to-end check of the worker against the real Compose Postgres and RabbitMQ.
// The worker runs as a child process, because src/jobQueue/worker.ts connects and consumes on import.
// Rows are committed (the worker uses its own connection), so each test cleans up after itself.
// Stop any `npm run dev:worker` first: it would compete for the same queue, though either
// worker would still mark the row as sent.

const QUEUE = emailQueue;

const db = new pg.Client({ connectionString: config.DATABASE_URL });
let connection: ChannelModel;
let channel: Channel;
let worker: ChildProcess;
const userIds: string[] = [];

async function createPendingNotification(): Promise<string> {
  const user = await db.query<{ id: string }>(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
    ['Worker Test', `${crypto.randomUUID()}@example.com`],
  );
  const userId = user.rows[0]!.id;
  userIds.push(userId);
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO notifications (user_id, channel, payload, status, attempts) VALUES ($1, $2, $3, $4, 0) RETURNING id',
    [userId, 'email', { message: 'hi' }, NotificationStatus.Pending],
  );
  return rows[0]!.id;
}

async function startWorker(failureRate: string): Promise<void> {
  worker = spawn(process.execPath, ['src/jobQueue/worker.ts'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, FAKE_CHANNEL_FAILURE_RATE: failureRate },
  });
  // Wait until the worker has declared the queue and started consuming.
  await new Promise<void>((resolve, reject) => {
    worker.once('exit', (code) => reject(new Error(`worker exited early with code ${code}`)));
    worker.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Waiting for messages')) resolve();
    });
  });
}

async function stopWorker(): Promise<void> {
  worker.removeAllListeners('exit');
  const exited = new Promise((resolve) => worker.once('exit', resolve));
  worker.kill('SIGTERM');
  await exited;
}

async function getStatus(id: string): Promise<string | undefined> {
  const { rows } = await db.query<{ status: string }>(
    'SELECT status FROM notifications WHERE id = $1',
    [id],
  );
  return rows[0]?.status;
}

async function waitForStatus(id: string, expected: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getStatus(id)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await getStatus(id), expected, `status did not become '${expected}' in time`);
}

describe('worker', () => {
  beforeAll(async () => {
    await db.connect();
    connection = await amqb.connect(config.RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue(QUEUE, queueOptions);
  });

  afterAll(async () => {
    await channel.close();
    await connection.close();
    // notifications.user_id is ON DELETE RESTRICT, so delete the notifications first.
    await db.query('DELETE FROM notifications WHERE user_id = ANY($1)', [userIds]);
    await db.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    await db.end();
  });

  describe('with the fake channel working', () => {
    beforeAll(() => startWorker('0'));
    afterAll(stopWorker);

    it('marks a pending notification as sent after its id is queued', async () => {
      const id = await createPendingNotification();
      assert.equal(await getStatus(id), NotificationStatus.Pending);

      channel.sendToQueue(QUEUE, Buffer.from(id));

      await waitForStatus(id, NotificationStatus.Sent);
    });

    it('survives an id that has no row and still processes the next message', async () => {
      channel.sendToQueue(QUEUE, Buffer.from(crypto.randomUUID()));
      const id = await createPendingNotification();
      channel.sendToQueue(QUEUE, Buffer.from(id));

      await waitForStatus(id, NotificationStatus.Sent);
    });
  });

  describe('with the fake channel forced to fail', () => {
    beforeAll(() => startWorker('1'));
    afterAll(stopWorker);

    it('marks the notification failed and records the error', async () => {
      const id = await createPendingNotification();

      channel.sendToQueue(QUEUE, Buffer.from(id));

      await waitForStatus(id, NotificationStatus.Failed);
      const { rows } = await db.query(
        'SELECT last_error, attempts FROM notifications WHERE id = $1',
        [id],
      );
      assert.equal(rows[0].last_error, 'FakeChannel forced failure');
      assert.equal(rows[0].attempts, 1);
    });
  });
});
