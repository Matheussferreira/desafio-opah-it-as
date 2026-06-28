import { ConsumeMessage } from 'amqplib';
import Decimal from 'decimal.js';
import { getChannel, QUEUE } from '../rabbitmq';
import { pool } from '../db';
import { getRedis } from '../redis';
import { logger } from '../logger';
import {
  eventsProcessedTotal,
  consumerRetriesTotal,
  consumerDlqTotal,
} from '../metrics';
import { withRetry } from '../utils/retry';

const MAX_RETRIES = 3;
// Backoff exponencial: 1s → 2s → 4s
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

interface LancamentoRegistradoEvent {
  eventoId: string;
  schemaVersion: string;
  tipo: string;
  correlationId?: string;
  createdAt: string;
  data: {
    lancamentoId: string;
    valor: string;
    tipo: 'credito' | 'debito';
    descricao?: string | null;
    data: string; // YYYY-MM-DD
  };
}

async function processEvent(
  event: LancamentoRegistradoEvent,
): Promise<'processed' | 'skipped'> {
  const { eventoId, correlationId, data: payload } = event;
  const log = logger.child({ eventoId, correlationId, lancamentoId: payload.lancamentoId });

  const valor = new Decimal(payload.valor);
  const isCredito = payload.tipo === 'credito';
  const deltaCredito = isCredito ? valor.toFixed(2) : '0';
  const deltaDebito = isCredito ? '0' : valor.toFixed(2);
  const deltaSaldo = isCredito ? valor.toFixed(2) : valor.negated().toFixed(2);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotência: tenta inserir o evento; rowCount=0 significa já processado
    const idempResult = await client.query(
      `INSERT INTO eventos_processados (evento_id) VALUES ($1)
       ON CONFLICT (evento_id) DO NOTHING`,
      [eventoId],
    );

    if (idempResult.rowCount === 0) {
      await client.query('ROLLBACK');
      log.info('Event already processed, skipping');
      return 'skipped';
    }

    // Upsert atômico: SET saldo = saldo + delta — nunca read-modify-write na aplicação
    await client.query(
      `INSERT INTO saldo_diario (data, total_creditos, total_debitos, saldo, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (data) DO UPDATE SET
         total_creditos = saldo_diario.total_creditos + $2,
         total_debitos  = saldo_diario.total_debitos  + $3,
         saldo          = saldo_diario.saldo          + $4,
         updated_at     = now()`,
      [payload.data, deltaCredito, deltaDebito, deltaSaldo],
    );

    await client.query('COMMIT');

    // Invalida cache — falha aqui não reverte o processamento do evento
    try {
      const redis = getRedis();
      await redis.del(`saldo:${payload.data}`);
    } catch (cacheErr) {
      log.warn({ cacheErr }, 'Failed to invalidate cache (non-fatal)');
    }

    log.info({ data: payload.data, tipo: payload.tipo, valor: payload.valor }, 'Event processed');
    return 'processed';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Estado de graceful shutdown
let consumerTag: string | null = null;
let inFlight = 0;
let shuttingDown = false;

export async function startConsumer(): Promise<void> {
  const channel = getChannel();

  const { consumerTag: tag } = await channel.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      // Durante shutdown: requeue para não perder mensagem em trânsito
      if (shuttingDown) {
        channel.nack(msg, false, true);
        return;
      }

      inFlight++;
      try {
        // Erros de parse são não-retryáveis
        let raw: LancamentoRegistradoEvent;
        try {
          raw = JSON.parse(msg.content.toString()) as LancamentoRegistradoEvent;
        } catch (parseErr) {
          logger.error({ parseErr }, 'Invalid JSON payload, sending to DLQ');
          eventsProcessedTotal.inc({ tipo: 'unknown', status: 'invalid' });
          consumerDlqTotal.inc();
          channel.nack(msg, false, false);
          return;
        }

        // Tipo desconhecido: ack (forward-compatible, não reprocessar)
        if (raw.tipo !== 'LancamentoRegistrado') {
          logger.warn({ tipo: raw.tipo }, 'Unknown event type, acknowledging');
          eventsProcessedTotal.inc({ tipo: raw.tipo, status: 'invalid' });
          channel.ack(msg);
          return;
        }

        const log = logger.child({ eventoId: raw.eventoId, correlationId: raw.correlationId });

        const result = await withRetry(
          () => processEvent(raw),
          MAX_RETRIES,
          RETRY_DELAYS_MS,
          (err, attempt) => {
            consumerRetriesTotal.inc();
            log.warn({ err, attempt, maxRetries: MAX_RETRIES }, 'Processing failed, retrying with backoff');
          },
        );

        if (result.ok) {
          eventsProcessedTotal.inc({ tipo: 'LancamentoRegistrado', status: result.value });
          channel.ack(msg);
        } else {
          log.error({ error: result.error }, 'Max retries exceeded, sending to DLQ');
          eventsProcessedTotal.inc({ tipo: 'LancamentoRegistrado', status: 'dlq' });
          consumerDlqTotal.inc();
          channel.nack(msg, false, false);
        }
      } finally {
        inFlight--;
      }
    },
  );

  consumerTag = tag;
  logger.info({ queue: QUEUE }, 'Consumer started');
}

export async function stopConsumer(): Promise<void> {
  shuttingDown = true;

  if (consumerTag) {
    try {
      await getChannel().cancel(consumerTag);
      logger.info({ consumerTag }, 'Consumer cancelled');
    } catch {
      // Canal pode já estar fechando
    }
    consumerTag = null;
  }

  // Aguarda a mensagem em processamento terminar (máx. 8s)
  const deadline = Date.now() + 8_000;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, 100));
  }

  if (inFlight > 0) {
    logger.warn({ inFlight }, 'Graceful shutdown deadline reached with in-flight messages');
  }
}
