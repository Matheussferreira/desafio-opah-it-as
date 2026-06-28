import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import { pool } from '../db';
import { logger } from '../logger';
import { lancamentosCreatedTotal } from '../metrics';

const router = Router();

const lancamentoSchema = z.object({
  valor: z
    .number({ required_error: 'valor é obrigatório' })
    .positive('valor deve ser positivo'),
  tipo: z.enum(['credito', 'debito'], {
    required_error: 'tipo deve ser "credito" ou "debito"',
  }),
  descricao: z.string().max(500).optional(),
  data: z
    .string({ required_error: 'data é obrigatória' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve estar no formato YYYY-MM-DD'),
});

// POST /lancamentos
router.post('/', async (req: Request, res: Response) => {
  const correlationId = (req.headers['x-correlation-id'] as string) ?? uuidv4();
  const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

  const parsed = lancamentoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { valor, tipo, descricao, data } = parsed.data;
  const valorDecimal = new Decimal(valor).toFixed(2);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotência dentro da transação: evita race condition sob requests concorrentes
    if (idempotencyKey) {
      const { rows: existing } = await client.query(
        'SELECT id, valor, tipo, descricao, data, created_at FROM lancamentos WHERE idempotency_key = $1',
        [idempotencyKey],
      );
      if (existing.length > 0) {
        await client.query('ROLLBACK');
        logger.info({ correlationId, idempotencyKey }, 'Duplicate request, returning existing');
        res.status(200).json(existing[0]);
        return;
      }
    }

    const { rows } = await client.query<{
      id: string;
      valor: string;
      tipo: string;
      descricao: string;
      data: string;
      created_at: string;
    }>(
      `INSERT INTO lancamentos (valor, tipo, descricao, data, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, valor, tipo, descricao, data, created_at`,
      [valorDecimal, tipo, descricao ?? null, data, idempotencyKey ?? null],
    );
    const lancamento = rows[0];

    const eventoId = uuidv4();
    const payload = {
      eventoId,
      schemaVersion: '1.0',
      tipo: 'LancamentoRegistrado',
      correlationId,
      createdAt: new Date().toISOString(),
      data: {
        lancamentoId: lancamento.id,
        valor: lancamento.valor,
        tipo: lancamento.tipo,
        descricao: lancamento.descricao,
        data: lancamento.data,
      },
    };

    await client.query(
      `INSERT INTO outbox (id, tipo_evento, payload) VALUES ($1, $2, $3)`,
      [eventoId, 'LancamentoRegistrado', JSON.stringify(payload)],
    );

    await client.query('COMMIT');

    lancamentosCreatedTotal.inc({ tipo });
    logger.info({ correlationId, lancamentoId: lancamento.id, eventoId }, 'Lancamento registered');
    res.status(201).json(lancamento);
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    // Constraint violation na idempotency_key: requests simultâneos com a mesma chave
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505' &&
      idempotencyKey
    ) {
      const { rows } = await client.query(
        'SELECT id, valor, tipo, descricao, data, created_at FROM lancamentos WHERE idempotency_key = $1',
        [idempotencyKey],
      );
      if (rows.length > 0) {
        logger.info({ correlationId, idempotencyKey }, 'Concurrent duplicate resolved');
        res.status(200).json(rows[0]);
        return;
      }
    }
    logger.error({ err, correlationId }, 'Error creating lancamento');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /lancamentos
router.get('/', async (req: Request, res: Response) => {
  const { data } = req.query;

  try {
    if (data) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) {
        res.status(400).json({ error: 'data deve estar no formato YYYY-MM-DD' });
        return;
      }
      const { rows } = await pool.query(
        'SELECT id, valor, tipo, descricao, data, created_at FROM lancamentos WHERE data = $1 ORDER BY created_at',
        [data],
      );
      res.json(rows);
    } else {
      const { rows } = await pool.query(
        'SELECT id, valor, tipo, descricao, data, created_at FROM lancamentos ORDER BY created_at DESC LIMIT 100',
      );
      res.json(rows);
    }
  } catch (err) {
    logger.error({ err }, 'Error listing lancamentos');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
