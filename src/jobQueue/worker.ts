import amqb from 'amqplib';
import { logger } from '../logger.ts';
import { pool } from '../db.ts';
import { createNotificationRepo } from '../repos/notificationRepo.ts';
import { createMessageHandler, responses } from './handleNotification.ts';
import { config } from '../envConfig.ts';
import { FakeChannel } from '../channels/fakeChannel.ts';
import { emailQueue, queueOptions } from './config.ts';
import { handleAckOnResponse } from './utils.ts';

const connection = await amqb.connect(config.RABBITMQ_URL);
const channel = await connection.createChannel();

await channel.assertQueue(emailQueue, queueOptions);

await channel.prefetch(1);

console.log(' [*] Waiting for messages in %s. To exit press CTRL+C', emailQueue);

const handleMessage = createMessageHandler({
  repo: createNotificationRepo(pool),
  logger,
  channel: new FakeChannel({ failureRate: config.FAKE_CHANNEL_FAILURE_RATE, logger }),
});

channel.consume(
  emailQueue,
  async function (msg) {
    if (!msg) return;

    // Without this, a rejected promise here is unhandled and Node exits the worker.
    try {
      logger.info(' [x] Received %s', msg.content.toString());
      const response = await handleMessage(msg);
      handleAckOnResponse(channel, response, msg);
    } catch (err) {
      logger.error({ err }, 'failed to process message');
      handleAckOnResponse(channel, responses.requeue, msg);
    }
  },
  {
    noAck: false,
  },
);
