import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

const router = Router();

// Endpoint de desenvolvimento — devolve um JWT válido sem autenticação real.
// NUNCA expor sem proteção em produção.
router.post('/login', (_req: Request, res: Response) => {
  const token = jwt.sign(
    { sub: 'dev-user', role: 'admin' },
    config.jwtSecret,
    { expiresIn: '24h' },
  );
  res.json({ token });
});

export default router;
