import amqb from 'amqplib';
import { logger } from '../logger.ts';
import { pool } from '../db.ts';
import { createMessageHandler } from './handleNotification.ts';
import { config } from '../envConfig.ts';
import { emailQueue, queueOptions } from './config.ts';

const connection = await amqb.connect(config.RABBITMQ_URL);
const channel = await connection.createChannel();

await channel.assertQueue(emailQueue, queueOptions);

console.log(' [*] Waiting for messages in %s. To exit press CTRL+C', emailQueue);

const handleMessage = createMessageHandler({ pool, logger });

channel.consume(
  emailQueue,
  async function (msg) {
    // Without this, a rejected promise here is unhandled and Node exits the worker.
    try {
      if (msg) console.log(' [x] Received %s', msg.content.toString());
      await handleMessage(msg);
    } catch (err) {
      logger.error({ err }, 'failed to process message');
    }
  },
  {
    noAck: true,
  },
);
