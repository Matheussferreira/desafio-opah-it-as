import Decimal from 'decimal.js';

function calcularSaldo(
  lancamentos: Array<{ tipo: 'credito' | 'debito'; valor: string }>,
): { totalCreditos: string; totalDebitos: string; saldo: string } {
  let totalCreditos = new Decimal(0);
  let totalDebitos = new Decimal(0);

  for (const l of lancamentos) {
    if (l.tipo === 'credito') {
      totalCreditos = totalCreditos.plus(l.valor);
    } else {
      totalDebitos = totalDebitos.plus(l.valor);
    }
  }

  return {
    totalCreditos: totalCreditos.toFixed(2),
    totalDebitos: totalDebitos.toFixed(2),
    saldo: totalCreditos.minus(totalDebitos).toFixed(2),
  };
}

describe('Cálculo de saldo diário', () => {
  it('calcula saldo com apenas créditos', () => {
    const result = calcularSaldo([
      { tipo: 'credito', valor: '1000.00' },
      { tipo: 'credito', valor: '500.50' },
    ]);
    expect(result.totalCreditos).toBe('1500.50');
    expect(result.totalDebitos).toBe('0.00');
    expect(result.saldo).toBe('1500.50');
  });

  it('calcula saldo com créditos e débitos', () => {
    const result = calcularSaldo([
      { tipo: 'credito', valor: '1500.00' },
      { tipo: 'debito', valor: '200.50' },
      { tipo: 'credito', valor: '3200.00' },
    ]);
    expect(result.totalCreditos).toBe('4700.00');
    expect(result.totalDebitos).toBe('200.50');
    expect(result.saldo).toBe('4499.50');
  });

  it('calcula saldo negativo (débitos > créditos)', () => {
    const result = calcularSaldo([
      { tipo: 'debito', valor: '500.00' },
      { tipo: 'credito', valor: '200.00' },
    ]);
    expect(result.saldo).toBe('-300.00');
  });

  it('retorna zeros para lista vazia', () => {
    const result = calcularSaldo([]);
    expect(result.totalCreditos).toBe('0.00');
    expect(result.totalDebitos).toBe('0.00');
    expect(result.saldo).toBe('0.00');
  });

  it('não sofre imprecisão de ponto flutuante', () => {
    const result = calcularSaldo([
      { tipo: 'credito', valor: '0.10' },
      { tipo: 'credito', valor: '0.20' },
    ]);
    // 0.1 + 0.2 = 0.30 (não 0.30000000000000004)
    expect(result.saldo).toBe('0.30');
  });
});

describe('Idempotência do consumidor', () => {
  it('não aplica o mesmo evento duas vezes', () => {
    const processados = new Set<string>();

    function processarEvento(eventoId: string, valor: Decimal): Decimal | null {
      if (processados.has(eventoId)) return null; // já processado
      processados.add(eventoId);
      return valor;
    }

    let saldo = new Decimal(0);

    const resultado1 = processarEvento('evt-001', new Decimal('100.00'));
    if (resultado1) saldo = saldo.plus(resultado1);

    // Reprocessamento do mesmo evento (simula redelivery)
    const resultado2 = processarEvento('evt-001', new Decimal('100.00'));
    if (resultado2) saldo = saldo.plus(resultado2);

    // Novo evento
    const resultado3 = processarEvento('evt-002', new Decimal('50.00'));
    if (resultado3) saldo = saldo.plus(resultado3);

    expect(saldo.toFixed(2)).toBe('150.00');
  });
});
