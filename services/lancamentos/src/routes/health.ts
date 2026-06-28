import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { getChannel } from '../rabbitmq';

const router = Router();

// Liveness: o processo está vivo?
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'lancamentos' });
});

// Readiness: o serviço está pronto para receber tráfego?
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    getChannel(); // lança se não inicializado
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: String(err) });
  }
});

export default router;
