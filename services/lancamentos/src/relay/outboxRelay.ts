import { pool } from '../db';
import { getChannel, EXCHANGE, ROUTING_KEY } from '../rabbitmq';
import { logger } from '../logger';
import { outboxEventsPublishedTotal } from '../metrics';

let running = false;
let timer: NodeJS.Timeout | null = null;

async function relay(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{
        id: string;
        tipo_evento: string;
        payload: object;
      }>(
        `SELECT id, tipo_evento, payload
         FROM outbox
         WHERE status = 'pendente'
         ORDER BY created_at
         LIMIT 50`,
      );

      for (const row of rows) {
        const ch = getChannel();
        const published = ch.publish(
          EXCHANGE,
          ROUTING_KEY,
          Buffer.from(JSON.stringify(row.payload)),
          {
            persistent: true,
            messageId: row.id,
            contentType: 'application/json',
          },
        );

        if (!published) {
          logger.warn({ eventId: row.id }, 'Channel write buffer full, stopping relay tick');
          break;
        }

        await client.query(
          `UPDATE outbox
           SET status = 'publicado', published_at = now()
           WHERE id = $1`,
          [row.id],
        );

        outboxEventsPublishedTotal.inc();
        logger.debug({ eventId: row.id, tipo: row.tipo_evento }, 'Event published');
      }
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Outbox relay error');
  } finally {
    running = false;
  }
}

export function startOutboxRelay(intervalMs: number): void {
  logger.info({ intervalMs }, 'Outbox relay started');
  timer = setInterval(relay, intervalMs);
}

export function stopOutboxRelay(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Outbox relay stopped');
  }
}
