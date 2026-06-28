import { Pool } from 'pg';
import { config } from './config';
import { logger } from './logger';

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function waitForDb(maxAttempts = 15, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      logger.info('Database connection established');
      return;
    } catch (err) {
      logger.warn({ attempt, maxAttempts }, 'Database not ready, retrying...');
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
