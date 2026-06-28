import app from './app';
import { config } from './config';
import { logger } from './logger';
import { pool, waitForDb } from './db';
import { runMigrations } from './migrations';
import { connectRabbitMQ, closeRabbitMQ } from './rabbitmq';
import { startOutboxRelay, stopOutboxRelay } from './relay/outboxRelay';

async function main(): Promise<void> {
  logger.info('Starting lancamentos service...');

  // 1. Aguarda banco e roda migrations
  await waitForDb();
  await runMigrations(pool);

  // 2. Conecta ao broker
  await connectRabbitMQ();

  // 3. Inicia relay do outbox
  startOutboxRelay(config.outboxIntervalMs);

  // 4. Sobe servidor HTTP
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'HTTP server listening');
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down gracefully...');
    stopOutboxRelay();
    server.close(async () => {
      await closeRabbitMQ();
      await pool.end();
      logger.info('Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
