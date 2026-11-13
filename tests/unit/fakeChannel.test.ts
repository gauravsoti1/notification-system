import { describe, expect, it, vi } from 'vitest';
import { FakeChannel } from '../../src/channels/fakeChannel.ts';
import type { Notification } from '../../src/channels/types.ts';

const notification: Notification = {
  id: '9ca70dbd-addd-4ec5-8ab7-e5b8c768f884',
  channel: 'email',
  payload: { message: 'hi' },
  userId: 'c3b0efe7-928a-41e2-a070-5c085f7612d0',
};

describe('FakeChannel', () => {
  it('succeeds and logs a fake send by default', async () => {
    const info = vi.fn();
    const channel = new FakeChannel({ logger: { info } as never });

    await expect(channel.send(notification)).resolves.toEqual({ ok: true });
    expect(info).toHaveBeenCalledWith(
      { notificationId: notification.id, channel: 'email', userId: notification.userId },
      'FAKE SEND',
    );
  });

  it('always fails, retryable, when the failure rate is 1', async () => {
    const info = vi.fn();
    const channel = new FakeChannel({ failureRate: 1, logger: { info } as never });

    await expect(channel.send(notification)).resolves.toEqual({
      ok: false,
      retryable: true,
      error: 'FakeChannel forced failure',
    });
    expect(info).not.toHaveBeenCalled();
  });

  it('can fail as non-retryable', async () => {
    const channel = new FakeChannel({ failureRate: 1, retryable: false });

    await expect(channel.send(notification)).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it('fails only when the random draw is below the failure rate', async () => {
    const random = vi.fn().mockReturnValueOnce(0.2).mockReturnValueOnce(0.7);
    const channel = new FakeChannel({ failureRate: 0.5, random });

    await expect(channel.send(notification)).resolves.toMatchObject({ ok: false });
    await expect(channel.send(notification)).resolves.toEqual({ ok: true });
  });
});
