/**
 * Teste de integração — retry exponencial e Dead Letter Queue.
 *
 * Pré-requisito: infra do docker-compose.integration.yml rodando.
 * Execute via: bash test-integration.sh (na raiz do projeto)
 *
 * O que é testado aqui que os testes unitários NÃO cobrem:
 *  - O broker RabbitMQ realmente aceita o nack e encaminha para a DLQ configurada
 *  - O consumer real chama withRetry na contagem certa de vezes
 *  - A mensagem lida da DLQ pelo broker é o payload original (round-trip completo)
 *  - Uma mensagem válida atravessa o pipeline e não contamina a DLQ
 */

import amqp, { Channel, ChannelModel } from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import {
  connectRabbitMQ,
  closeRabbitMQ,
  EXCHANGE,
  ROUTING_KEY,
  DLQ,
} from '../../src/rabbitmq';
import { pool } from '../../src/db';
import { runMigrations } from '../../src/migrations';
import { connectRedis, closeRedis } from '../../src/redis';
import { startConsumer, stopConsumer } from '../../src/consumer/lancamentosConsumer';
import { consumerRetriesTotal, consumerDlqTotal } from '../../src/metrics';

// Lê o valor atual de um Counter (sem labels) de forma segura
async function counterValue(counter: {
  get(): Promise<{ values: Array<{ value: number }> }>;
}): Promise<number> {
  const { values } = await counter.get();
  return values.reduce((sum, v) => sum + v.value, 0);
}

describe('Integração — retry com backoff e Dead Letter Queue', () => {
  let pubConn: ChannelModel;
  let pubCh: Channel;

  beforeAll(async () => {
    // Migra o schema do consolidado_db no banco de teste
    await runMigrations(pool);

    // Conecta infra real (aponta para docker-compose.integration.yml via env)
    await connectRedis();
    await connectRabbitMQ();

    // Inicia o consumer real — mesmo código que roda em produção
    await startConsumer();

    // Canal separado para publicar mensagens de teste e ler a DLQ
    // (não compartilha com o canal interno do consumer)
    pubConn = await amqp.connect(process.env.RABBITMQ_URL!);
    pubCh = await pubConn.createChannel();
  }, 30_000);

  afterAll(async () => {
    await stopConsumer();
    try {
      await pubCh.close();
    } catch { /* já fechado */ }
    try {
      await pubConn.close();
    } catch { /* já fechado */ }
    await closeRabbitMQ();
    await closeRedis();
    await pool.end();
  });

  it(
    'tenta exatamente 3 vezes com backoff e envia a mensagem para a DLQ do broker',
    async () => {
      const baseRetries = await counterValue(consumerRetriesTotal);
      const baseDlq = await counterValue(consumerDlqTotal);

      // Payload que sempre falha: new Decimal('INVALID_FOR_TEST') lança exceção
      // dentro de processEvent ANTES de qualquer acesso ao banco — falha determinística.
      const eventoId = uuidv4();
      const badPayload = {
        eventoId,
        schemaVersion: '1',
        tipo: 'LancamentoRegistrado',
        correlationId: `inttest-dlq-${eventoId.slice(0, 8)}`,
        createdAt: new Date().toISOString(),
        data: {
          lancamentoId: uuidv4(),
          valor: 'INVALID_FOR_TEST', // new Decimal('INVALID_FOR_TEST') → throw imediato
          tipo: 'credito',
          data: '2024-06-15',
        },
      };

      pubCh.publish(
        EXCHANGE,
        ROUTING_KEY,
        Buffer.from(JSON.stringify(badPayload)),
        { persistent: true, messageId: eventoId },
      );

      // Backoff configurado no consumer: [1000, 2000, 4000] ms = 7 s total.
      // Aguarda 9 s para ter folga de ~2 s de overhead.
      await new Promise<void>(r => setTimeout(r, 9_000));

      // — assert 1: onRetry foi chamado 3 vezes (uma por tentativa intermediária)
      const afterRetries = await counterValue(consumerRetriesTotal);
      expect(afterRetries - baseRetries).toBe(3);

      // — assert 2: o counter de DLQ incrementou exatamente 1
      const afterDlq = await counterValue(consumerDlqTotal);
      expect(afterDlq - baseDlq).toBe(1);

      // — assert 3: a mensagem está DE FATO na DLQ do broker (não só no contador)
      const dlqMsg = await pubCh.get(DLQ, { noAck: false });
      expect(dlqMsg).not.toBe(false); // false = fila vazia

      if (dlqMsg !== false) {
        const parsed = JSON.parse(dlqMsg.content.toString()) as { eventoId: string };
        // O payload chegou intacto — é o mesmo eventoId que publicamos
        expect(parsed.eventoId).toBe(eventoId);
        pubCh.ack(dlqMsg); // remove da DLQ para não poluir outros testes
      }
    },
    15_000,
  );

  it(
    'mensagem válida processa sem ir para DLQ e atualiza o saldo no banco',
    async () => {
      const baseDlq = await counterValue(consumerDlqTotal);

      const eventoId = uuidv4();
      const validPayload = {
        eventoId,
        schemaVersion: '1',
        tipo: 'LancamentoRegistrado',
        correlationId: `inttest-valid-${eventoId.slice(0, 8)}`,
        createdAt: new Date().toISOString(),
        data: {
          lancamentoId: uuidv4(),
          valor: '375.50',
          tipo: 'credito',
          data: '2024-06-15',
        },
      };

      pubCh.publish(
        EXCHANGE,
        ROUTING_KEY,
        Buffer.from(JSON.stringify(validPayload)),
        { persistent: true, messageId: eventoId },
      );

      // Processamento normal: sem retries, deve concluir em < 2 s
      await new Promise<void>(r => setTimeout(r, 3_000));

      // — assert 1: DLQ não cresceu
      const afterDlq = await counterValue(consumerDlqTotal);
      expect(afterDlq - baseDlq).toBe(0);

      // — assert 2: DLQ está vazia no broker
      const dlqMsg = await pubCh.get(DLQ, { noAck: true });
      expect(dlqMsg).toBe(false);

      // — assert 3: saldo foi gravado no banco (prova que o processamento foi end-to-end)
      const { rows } = await pool.query<{ saldo: string }>(
        'SELECT saldo FROM saldo_diario WHERE data = $1',
        ['2024-06-15'],
      );
      expect(rows).toHaveLength(1);
      // O test 1 pode ter deixado parciais no banco? Não — o payload inválido falha
      // ANTES do pool.connect(), então nenhuma linha foi inserida por ele.
      expect(parseFloat(rows[0].saldo)).toBeCloseTo(375.5, 2);
    },
    10_000,
  );
});
