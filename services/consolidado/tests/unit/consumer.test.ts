import { withRetry } from '../../src/utils/retry';

describe('withRetry', () => {
  it('retorna ok na primeira tentativa bem-sucedida', async () => {
    const fn = jest.fn().mockResolvedValue('resultado');

    const result = await withRetry(fn, 3, [0, 0, 0]);

    expect(result).toEqual({ ok: true, value: 'resultado' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retenta e sucede na segunda tentativa', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('falha temporária'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, 3, [0, 0, 0]);

    expect(result).toEqual({ ok: true, value: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retenta e sucede na última tentativa permitida', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('falha 1'))
      .mockRejectedValueOnce(new Error('falha 2'))
      .mockRejectedValueOnce(new Error('falha 3'))
      .mockResolvedValue('sucesso tardio');

    const result = await withRetry(fn, 3, [0, 0, 0]);

    expect(result).toEqual({ ok: true, value: 'sucesso tardio' });
    expect(fn).toHaveBeenCalledTimes(4); // tentativa inicial + 3 retries
  });

  it('retorna not-ok após esgotar todas as tentativas', async () => {
    const erroFinal = new Error('sempre falha');
    const fn = jest.fn().mockRejectedValue(erroFinal);

    const result = await withRetry(fn, 3, [0, 0, 0]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(erroFinal);
    }
    expect(fn).toHaveBeenCalledTimes(4); // tentativa inicial + 3 retries
  });

  it('chama onRetry com erro e número da tentativa a cada falha intermediária', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValue('ok');
    const onRetry = jest.fn();

    await withRetry(fn, 3, [0, 0, 0], onRetry);

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2);
  });

  it('não chama onRetry quando sucede na primeira tentativa', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const onRetry = jest.fn();

    await withRetry(fn, 3, [0, 0, 0], onRetry);

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('não chama onRetry na última tentativa falha (já vai para DLQ)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('sempre falha'));
    const onRetry = jest.fn();

    await withRetry(fn, 2, [0, 0], onRetry);

    // maxRetries=2 → 3 tentativas; onRetry chamado apenas nas 2 primeiras falhas
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('simula redelivery: idempotência impede duplo processamento', async () => {
    const processados = new Set<string>();
    let saldo = 0;

    const processarEvento = async (eventoId: string, delta: number): Promise<void> => {
      if (processados.has(eventoId)) return; // idempotente
      processados.add(eventoId);
      saldo += delta;
    };

    // Primeira entrega
    await withRetry(() => processarEvento('evt-abc', 100), 3, [0, 0, 0]);
    // Redelivery do mesmo evento (broker reenvia por falta de ack)
    await withRetry(() => processarEvento('evt-abc', 100), 3, [0, 0, 0]);
    // Novo evento diferente
    await withRetry(() => processarEvento('evt-xyz', 50), 3, [0, 0, 0]);

    expect(saldo).toBe(150); // 100 + 50, o redelivery não contou
  });
});
