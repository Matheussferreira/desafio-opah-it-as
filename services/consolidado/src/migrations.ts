import { Pool } from 'pg';
import { logger } from './logger';

const migrations = [
  {
    name: '001_create_tables',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS saldo_diario (
        data            DATE          PRIMARY KEY,
        total_creditos  NUMERIC(15,2) NOT NULL DEFAULT 0,
        total_debitos   NUMERIC(15,2) NOT NULL DEFAULT 0,
        saldo           NUMERIC(15,2) NOT NULL DEFAULT 0,
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS eventos_processados (
        evento_id    UUID        PRIMARY KEY,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id     SERIAL      PRIMARY KEY,
      name   TEXT        UNIQUE NOT NULL,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const m of migrations) {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM _migrations WHERE name = $1',
      [m.name],
    );
    if (rowCount && rowCount > 0) continue;

    await pool.query(m.sql);
    await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [m.name]);
    logger.info({ migration: m.name }, 'Migration applied');
  }
}
