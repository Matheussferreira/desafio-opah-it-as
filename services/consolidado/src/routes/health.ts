import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { getRedis } from '../redis';
import { getChannel } from '../rabbitmq';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'consolidado' });
});

router.get('/ready', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    await getRedis().ping();
    getChannel();
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: String(err) });
  }
});

export default router;
