import amqp, { Channel, ChannelModel } from 'amqplib';
import { config } from './config';
import { logger } from './logger';

export const EXCHANGE = 'lancamentos.events';
export const QUEUE = 'consolidado.lancamentos';
export const ROUTING_KEY = 'lancamento.registrado';
export const DLX = 'lancamentos.events.dlx';
export const DLQ = 'consolidado.lancamentos.dlq';

let model: ChannelModel | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ(maxAttempts = 15, delayMs = 3000): Promise<Channel> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      model = await amqp.connect(config.rabbitmqUrl);
      channel = await model.createChannel();

      // Dead-letter setup
      await channel.assertExchange(DLX, 'topic', { durable: true });
      await channel.assertQueue(DLQ, { durable: true });
      await channel.bindQueue(DLQ, DLX, '#');

      // Main exchange e fila com DLX configurado
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': DLX,
          'x-dead-letter-routing-key': ROUTING_KEY,
        },
      });
      await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

      // prefetch=1 garante processamento sequencial por consumidor (seguro para N réplicas)
      channel.prefetch(1);

      model.on('error', err => logger.error({ err }, 'RabbitMQ connection error'));
      model.on('close', () => logger.warn('RabbitMQ connection closed'));

      logger.info('RabbitMQ connected');
      return channel;
    } catch (err) {
      logger.warn({ attempt, maxAttempts }, 'RabbitMQ not ready, retrying...');
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Could not connect to RabbitMQ');
}

export function getChannel(): Channel {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
}

export async function closeRabbitMQ(): Promise<void> {
  try {
    await channel?.close();
    await model?.close();
  } catch {
    // ignore on shutdown
  }
}
