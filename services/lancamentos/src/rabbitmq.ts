import amqp, { Channel, ChannelModel } from 'amqplib';
import { config } from './config';
import { logger } from './logger';

export const EXCHANGE = 'lancamentos.events';
export const ROUTING_KEY = 'lancamento.registrado';
// O produtor também declara a fila consumer para evitar perda de mensagens
// publicadas antes que o Consolidado tenha subido e declarado a fila.
const CONSUMER_QUEUE = 'consolidado.lancamentos';
const DLX = 'lancamentos.events.dlx';
const DLQ = 'consolidado.lancamentos.dlq';

let model: ChannelModel | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ(maxAttempts = 15, delayMs = 3000): Promise<Channel> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      model = await amqp.connect(config.rabbitmqUrl);
      channel = await model.createChannel();

      // Declara DLX e DLQ
      await channel.assertExchange(DLX, 'topic', { durable: true });
      await channel.assertQueue(DLQ, { durable: true });
      await channel.bindQueue(DLQ, DLX, '#');

      // Declara exchange principal
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      // Declara a fila consumer para que mensagens não sejam perdidas
      // antes que o Consolidado tenha subido
      await channel.assertQueue(CONSUMER_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': DLX,
          'x-dead-letter-routing-key': ROUTING_KEY,
        },
      });
      await channel.bindQueue(CONSUMER_QUEUE, EXCHANGE, ROUTING_KEY);

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
    // ignore errors on shutdown
  }
}
