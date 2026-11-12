import amqb from 'amqplib';
import { config } from '../envConfig.ts';
import { emailQueue, queueOptions } from './config.ts';

const connection = await amqb.connect(config.RABBITMQ_URL);
const channel = await connection.createChannel();

await channel.assertQueue(emailQueue, queueOptions);

export const enqueue = (msg: string) => channel.sendToQueue(emailQueue, Buffer.from(msg));
