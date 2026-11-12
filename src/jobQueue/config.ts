import amqb from 'amqplib';

export const emailQueue = 'notifications.email';
export const queueOptions: amqb.Options.AssertQueue = {
  durable: true,
  arguments: { 'x-queue-type': 'quorum' },
};
