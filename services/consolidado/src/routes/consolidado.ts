import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { getRedis } from '../redis';
import { config } from '../config';
import { logger } from '../logger';

const router = Router();

router.get('/:data', async (req: Request, res: Response) => {
  const { data } = req.params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    res.status(400).json({ error: 'data deve estar no formato YYYY-MM-DD' });
    return;
  }

  const cacheKey = `saldo:${data}`;

  try {
    // 1. Tenta servir do cache
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug({ data, source: 'cache' }, 'Serving from cache');
      res.json({ source: 'cache', ...JSON.parse(cached) });
      return;
    }
  } catch (cacheErr) {
    // Cache indisponível — fallback no banco sem interromper o fluxo
    logger.warn({ cacheErr }, 'Redis unavailable, falling back to database');
  }

  // 2. Fallback no banco
  try {
    const { rows } = await pool.query(
      `SELECT data, total_creditos, total_debitos, saldo, updated_at
       FROM saldo_diario
       WHERE data = $1`,
      [data],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: `Nenhum consolidado encontrado para ${data}` });
      return;
    }

    const result = rows[0];

    // Armazena no cache com TTL
    try {
      const redis = getRedis();
      await redis.setex(cacheKey, config.cacheTtlSeconds, JSON.stringify(result));
    } catch {
      // não bloqueia se cache falhar
    }

    logger.debug({ data, source: 'database' }, 'Serving from database');
    res.json({ source: 'database', ...result });
  } catch (err) {
    logger.error({ err }, 'Error fetching consolidado');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
