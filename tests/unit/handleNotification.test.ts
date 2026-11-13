import type { ConsumeMessage } from 'amqplib';
import { describe, expect, it, vi } from 'vitest';
import type { SendResult } from '../../src/channels/types.ts';
import { createMessageHandler } from '../../src/jobQueue/handleNotification.ts';
import type { NotificationRecord } from '../../src/notificationRepo.ts';
import { NotificationStatus } from '../../src/notificationStatus.ts';

// Unit tests: the repo, channel and logger are fakes, so no Postgres or RabbitMQ is needed.
// The SQL itself is tested in tests/integration/notificationRepo.test.ts.

const id = '9ca70dbd-addd-4ec5-8ab7-e5b8c768f884';
const message = (body: string) => ({ content: Buffer.from(body) }) as ConsumeMessage;

const record = (status: string): NotificationRecord => ({
  id,
  channel: 'email',
  payload: { message: 'hi' },
  userId: 'c3b0efe7-928a-41e2-a070-5c085f7612d0',
  status,
});

function setup({
  found = record(NotificationStatus.Pending),
  markSent = true,
  sendResult = { ok: true },
}: {
  found?: NotificationRecord | null;
  markSent?: boolean;
  sendResult?: SendResult;
} = {}) {
  const repo = {
    findById: vi.fn().mockResolvedValue(found),
    markSent: vi.fn().mockResolvedValue(markSent),
    markFailed: vi.fn().mockResolvedValue(true),
  };
  const send = vi.fn().mockResolvedValue(sendResult);
  const info = vi.fn();
  const warn = vi.fn();
  const handle = createMessageHandler({
    repo,
    logger: { info, warn } as never,
    channel: { send },
  });
  return { handle, repo, send, info, warn };
}

describe('createMessageHandler', () => {
  it('loads the notification by the message body, sends it, then marks it sent', async () => {
    const { handle, repo, send } = setup();

    await handle(message(id));

    expect(repo.findById).toHaveBeenCalledWith(id);
    expect(send).toHaveBeenCalledWith({
      id,
      channel: 'email',
      payload: { message: 'hi' },
      userId: 'c3b0efe7-928a-41e2-a070-5c085f7612d0',
    });
    expect(repo.markSent).toHaveBeenCalledWith(id);
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('logs info when the notification was marked sent', async () => {
    const { handle, info, warn } = setup();

    await handle(message(id));

    expect(info).toHaveBeenCalledWith({ notificationId: id }, 'notification marked sent');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a warning when marking sent matched no row', async () => {
    const { handle, warn } = setup({ markSent: false });

    await handle(message(id));

    expect(warn).toHaveBeenCalledWith(
      { notificationId: id },
      'no notification row found to update',
    );
  });

  it('marks the notification failed and records the error when the send fails', async () => {
    const { handle, repo, warn } = setup({
      sendResult: { ok: false, retryable: true, error: 'provider timeout' },
    });

    await handle(message(id));

    expect(repo.markFailed).toHaveBeenCalledWith(id, 'provider timeout');
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { notificationId: id, retryable: true, error: 'provider timeout' },
      'send failed',
    );
  });

  it('warns and skips the send and update when the notification does not exist', async () => {
    const { handle, repo, send, info, warn } = setup({ found: null });

    await handle(message(id));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(id));
    expect(info).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
  });

  it('skips the send and update when the notification is already sent', async () => {
    const { handle, repo, send, info } = setup({ found: record(NotificationStatus.Sent) });

    await handle(message(id));

    expect(info).toHaveBeenCalledWith(expect.stringContaining('already sent'));
    expect(send).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
  });

  it('drops a message whose body is not a UUID without touching the repo', async () => {
    const { handle, repo, warn } = setup();

    await handle(message('First email'));

    expect(repo.findById).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('First email'));
  });

  it('does nothing but log when the consumer is cancelled (null message)', async () => {
    const { handle, repo, info } = setup();

    await handle(null);

    expect(repo.findById).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Empty message in the queue');
  });

  it('lets a repo error propagate', async () => {
    const { handle, repo } = setup();
    repo.findById.mockRejectedValue(new Error('db down'));

    await expect(handle(message(id))).rejects.toThrow('db down');
  });
});
