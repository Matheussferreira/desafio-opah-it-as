import app from './app';
import { config } from './config';
import { logger } from './logger';
import { pool, waitForDb } from './db';
import { runMigrations } from './migrations';
import { connectRabbitMQ, closeRabbitMQ } from './rabbitmq';
import { connectRedis, closeRedis } from './redis';
import { startConsumer, stopConsumer } from './consumer/lancamentosConsumer';

async function main(): Promise<void> {
  logger.info('Starting consolidado service...');

  await waitForDb();
  await runMigrations(pool);
  await connectRedis();
  await connectRabbitMQ();
  await startConsumer();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'HTTP server listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down gracefully...');

    // 1. Para de aceitar novas conexões HTTP
    server.close(async () => {
      // 2. Cancela o consumer e aguarda mensagem em andamento terminar
      await stopConsumer();
      // 3. Fecha conexões em ordem reversa de dependência
      await closeRabbitMQ();
      await closeRedis();
      await pool.end();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Força saída se o drain demorar mais de 10s
    setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
