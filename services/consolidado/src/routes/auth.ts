import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

const router = Router();

router.post('/login', (_req: Request, res: Response) => {
  const token = jwt.sign(
    { sub: 'dev-user', role: 'admin' },
    config.jwtSecret,
    { expiresIn: '24h' },
  );
  res.json({ token });
});

export default router;
