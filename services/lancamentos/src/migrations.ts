import { Pool } from 'pg';
import { logger } from './logger';

const migrations = [
  {
    name: '001_create_tables',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS lancamentos (
        id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        valor            NUMERIC(15,2) NOT NULL CHECK (valor > 0),
        tipo             VARCHAR(10)   NOT NULL CHECK (tipo IN ('credito','debito')),
        descricao        TEXT,
        data             DATE          NOT NULL,
        idempotency_key  TEXT          UNIQUE,
        created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_lancamentos_data ON lancamentos(data);

      CREATE TABLE IF NOT EXISTS outbox (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo_evento  TEXT        NOT NULL,
        payload      JSONB       NOT NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente','publicado')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status) WHERE status = 'pendente';
    `,
  },
  {
    name: '002_seed',
    sql: `
      -- Insere lançamentos e os respectivos eventos no outbox (mesma semântica do serviço)
      DO $$
      DECLARE
        id1 UUID := gen_random_uuid();
        id2 UUID := gen_random_uuid();
        id3 UUID := gen_random_uuid();
        ev1 UUID := gen_random_uuid();
        ev2 UUID := gen_random_uuid();
        ev3 UUID := gen_random_uuid();
      BEGIN
        INSERT INTO lancamentos (id, valor, tipo, descricao, data, idempotency_key)
        VALUES
          (id1, 1500.00, 'credito', 'Venda produto A', CURRENT_DATE - 1, 'seed-001'),
          (id2,  200.50, 'debito',  'Compra insumos',  CURRENT_DATE - 1, 'seed-002'),
          (id3, 3200.00, 'credito', 'Venda produto B', CURRENT_DATE,     'seed-003')
        ON CONFLICT (idempotency_key) DO NOTHING;

        INSERT INTO outbox (id, tipo_evento, payload)
        SELECT ev1, 'LancamentoRegistrado', jsonb_build_object(
          'eventoId', ev1, 'schemaVersion', '1.0', 'tipo', 'LancamentoRegistrado',
          'correlationId', gen_random_uuid(), 'createdAt', now(),
          'data', jsonb_build_object('lancamentoId', id1, 'valor', '1500.00',
            'tipo', 'credito', 'descricao', 'Venda produto A', 'data', (CURRENT_DATE - 1)::text)
        ) WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE id = ev1);

        INSERT INTO outbox (id, tipo_evento, payload)
        SELECT ev2, 'LancamentoRegistrado', jsonb_build_object(
          'eventoId', ev2, 'schemaVersion', '1.0', 'tipo', 'LancamentoRegistrado',
          'correlationId', gen_random_uuid(), 'createdAt', now(),
          'data', jsonb_build_object('lancamentoId', id2, 'valor', '200.50',
            'tipo', 'debito', 'descricao', 'Compra insumos', 'data', (CURRENT_DATE - 1)::text)
        ) WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE id = ev2);

        INSERT INTO outbox (id, tipo_evento, payload)
        SELECT ev3, 'LancamentoRegistrado', jsonb_build_object(
          'eventoId', ev3, 'schemaVersion', '1.0', 'tipo', 'LancamentoRegistrado',
          'correlationId', gen_random_uuid(), 'createdAt', now(),
          'data', jsonb_build_object('lancamentoId', id3, 'valor', '3200.00',
            'tipo', 'credito', 'descricao', 'Venda produto B', 'data', CURRENT_DATE::text)
        ) WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE id = ev3);
      END $$;
    `,
  },
];

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id       SERIAL      PRIMARY KEY,
      name     TEXT        UNIQUE NOT NULL,
      ran_at   TIMESTAMPTZ NOT NULL DEFAULT now()
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
