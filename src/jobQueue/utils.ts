import { type Channel, type ConsumeMessage } from 'amqplib';
import type { Responses } from './handleNotification.ts';

export function handleAckOnResponse(channel: Channel, response: Responses, msg: ConsumeMessage) {
  if (response === 'ack') channel.ack(msg);
  else if (response === 'nack') channel.nack(msg, false, false);
  else if (response === 'requeue') channel.nack(msg, false, true);
}
