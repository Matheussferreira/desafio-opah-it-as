import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: 60_000,
  max: 1_200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});
