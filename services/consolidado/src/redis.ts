import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialized');
  return client;
}

export async function connectRedis(maxAttempts = 15, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const redis = new Redis(config.redisUrl, { lazyConnect: true });
      await redis.connect();
      await redis.ping();
      client = redis;
      logger.info('Redis connected');
      return;
    } catch (err) {
      logger.warn({ attempt, maxAttempts }, 'Redis not ready, retrying...');
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

export async function closeRedis(): Promise<void> {
  await client?.quit();
}
