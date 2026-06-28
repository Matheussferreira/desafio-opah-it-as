import { z } from 'zod';
import Decimal from 'decimal.js';

const lancamentoSchema = z.object({
  valor: z.number().positive(),
  tipo: z.enum(['credito', 'debito']),
  descricao: z.string().max(500).optional(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

describe('Lancamento validation', () => {
  it('accepts a valid credito', () => {
    const result = lancamentoSchema.safeParse({
      valor: 100.5,
      tipo: 'credito',
      data: '2024-01-15',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid debito', () => {
    const result = lancamentoSchema.safeParse({
      valor: 50,
      tipo: 'debito',
      descricao: 'Pagamento fornecedor',
      data: '2024-01-15',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative valor', () => {
    const result = lancamentoSchema.safeParse({
      valor: -10,
      tipo: 'credito',
      data: '2024-01-15',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tipo', () => {
    const result = lancamentoSchema.safeParse({
      valor: 10,
      tipo: 'transferencia',
      data: '2024-01-15',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = lancamentoSchema.safeParse({
      valor: 10,
      tipo: 'credito',
      data: '15/01/2024',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero valor', () => {
    const result = lancamentoSchema.safeParse({
      valor: 0,
      tipo: 'credito',
      data: '2024-01-15',
    });
    expect(result.success).toBe(false);
  });
});

describe('Decimal arithmetic (monetary correctness)', () => {
  it('avoids floating-point issues with Decimal.js', () => {
    // 0.1 + 0.2 = 0.30000000000000004 with native float
    const result = new Decimal('0.1').plus('0.2').toFixed(2);
    expect(result).toBe('0.30');
  });

  it('correctly calculates saldo from multiple lancamentos', () => {
    const lancamentos = [
      { tipo: 'credito', valor: new Decimal('1500.00') },
      { tipo: 'debito', valor: new Decimal('200.50') },
      { tipo: 'credito', valor: new Decimal('3200.00') },
    ];

    const saldo = lancamentos.reduce((acc, l) => {
      return l.tipo === 'credito' ? acc.plus(l.valor) : acc.minus(l.valor);
    }, new Decimal('0'));

    expect(saldo.toFixed(2)).toBe('4499.50');
  });

  it('handles large values correctly', () => {
    const large = new Decimal('9999999999999.99');
    const result = large.plus('0.01');
    expect(result.toFixed(2)).toBe('10000000000000.00');
  });
});
