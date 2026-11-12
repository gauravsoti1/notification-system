import type { ConsumeMessage } from 'amqplib';
import { describe, expect, it, vi } from 'vitest';
import { createMessageHandler } from '../../src/jobQueue/handleNotification.ts';
import { NotificationStatus } from '../../src/notificationStatus.ts';

// Unit tests: the pool and logger are fakes, so no Postgres or RabbitMQ is needed.

const id = '9ca70dbd-addd-4ec5-8ab7-e5b8c768f884';
const message = (body: string) => ({ content: Buffer.from(body) }) as ConsumeMessage;

const row = (status: string) => ({
  channel: 'email',
  payload: { message: 'hi' },
  user_id: 'c3b0efe7-928a-41e2-a070-5c085f7612d0',
  status,
});

// The handler runs two queries in order: a SELECT of the row, then an UPDATE.
function setup({ rows, rowCount = 1 }: { rows: unknown[]; rowCount?: number | null }) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: [], rowCount });
  const info = vi.fn();
  const warn = vi.fn();
  const handle = createMessageHandler({
    pool: { query } as never,
    logger: { info, warn } as never,
  });
  return { handle, query, info, warn };
}

describe('createMessageHandler', () => {
  it('loads the row by the message body, then marks it sent', async () => {
    const { handle, query } = setup({ rows: [row(NotificationStatus.Pending)] });

    await handle(message(id));

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual([
      expect.stringMatching(/SELECT .* from notifications/),
      [id],
    ]);
    expect(query.mock.calls[1]).toEqual([
      expect.stringMatching(/UPDATE notifications SET status = \$1 where id = \$2/),
      [NotificationStatus.Sent, id],
    ]);
  });

  it('logs the fake send with the loaded row data', async () => {
    const { handle, info } = setup({ rows: [row(NotificationStatus.Pending)] });

    await handle(message(id));

    expect(info).toHaveBeenCalledWith(
      {
        notificationId: id,
        channel: 'email',
        userId: 'c3b0efe7-928a-41e2-a070-5c085f7612d0',
      },
      'FAKE SEND',
    );
  });

  it('logs info when one row was updated', async () => {
    const { handle, info, warn } = setup({ rows: [row(NotificationStatus.Pending)] });

    await handle(message(id));

    expect(info).toHaveBeenCalledWith({ notificationId: id }, 'notification marked sent');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a warning when the update matched no row', async () => {
    const { handle, warn } = setup({ rows: [row(NotificationStatus.Pending)], rowCount: 0 });

    await handle(message(id));

    expect(warn).toHaveBeenCalledWith(
      { notificationId: id },
      'no notification row found to update',
    );
  });

  it('warns and skips the send and update when the row does not exist', async () => {
    const { handle, query, info, warn } = setup({ rows: [] });

    await handle(message(id));

    expect(query).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(id));
    expect(info).not.toHaveBeenCalled();
  });

  it('skips the send and update when the notification is already sent', async () => {
    const { handle, query, info } = setup({ rows: [row(NotificationStatus.Sent)] });

    await handle(message(id));

    expect(query).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('already sent'));
    expect(info).not.toHaveBeenCalledWith(expect.anything(), 'FAKE SEND');
  });

  it('does nothing but log when the consumer is cancelled (null message)', async () => {
    const { handle, query, info } = setup({ rows: [] });

    await handle(null);

    expect(query).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Empty message in the queue');
  });

  it('lets a database error propagate', async () => {
    const query = vi.fn().mockRejectedValue(new Error('db down'));
    const handle = createMessageHandler({
      pool: { query } as never,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
    });

    await expect(handle(message(id))).rejects.toThrow('db down');
  });
});
