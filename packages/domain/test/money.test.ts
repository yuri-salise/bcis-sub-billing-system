import { describe, it, expect } from 'vitest';
import {
  parseCurrencyToCentavos,
  formatCurrency,
  centavosToPesos,
  calculateProration,
} from '../src/money.js';

describe('Financial Arithmetic & Integer Centavos (ADR-004)', () => {
  describe('parseCurrencyToCentavos', () => {
    it('parses standard peso decimal strings into integer centavos', () => {
      expect(parseCurrencyToCentavos('999.00')).toBe(99900);
      expect(parseCurrencyToCentavos('1499.50')).toBe(149950);
      expect(parseCurrencyToCentavos('₱1,499.50')).toBe(149950);
      expect(parseCurrencyToCentavos('999')).toBe(99900);
      expect(parseCurrencyToCentavos('0.50')).toBe(50);
      expect(parseCurrencyToCentavos('0.05')).toBe(5);
    });

    it('accepts integer centavos directly', () => {
      expect(parseCurrencyToCentavos(99900)).toBe(99900);
    });

    it('rejects floating point numbers directly passed to avoid precision loss', () => {
      expect(() => parseCurrencyToCentavos(999.5)).toThrowError(/Float values are not allowed/);
    });
  });

  describe('formatCurrency', () => {
    it('formats integer centavos to Philippine Peso currency strings', () => {
      expect(formatCurrency(99900)).toBe('₱999.00');
      expect(formatCurrency(149950)).toBe('₱1,499.50');
      expect(formatCurrency(50)).toBe('₱0.50');
      expect(formatCurrency(0)).toBe('₱0.00');
    });

    it('handles negative balances correctly', () => {
      expect(formatCurrency(-50000)).toBe('-₱500.00');
    });

    it('rejects non-integer centavos', () => {
      expect(() => formatCurrency(999.99)).toThrowError(/requires an integer/);
    });
  });

  describe('centavosToPesos', () => {
    it('converts integer centavos to decimal representation', () => {
      expect(centavosToPesos(99900)).toBe(999);
      expect(centavosToPesos(149950)).toBe(1499.5);
    });
  });

  describe('calculateProration', () => {
    it('calculates exact half-up prorated charges for mid-cycle activations', () => {
      // ₱999.00 MRC (99900 centavos) activated on 16th of 30-day month (15 active days)
      // (99900 * 15) / 30 = 49950 centavos (₱499.50)
      const prorated = calculateProration(99900, 15, 30);
      expect(prorated).toBe(49950);
      expect(formatCurrency(prorated)).toBe('₱499.50');
    });

    it('handles full month as unprorated full charge', () => {
      expect(calculateProration(99900, 30, 30)).toBe(99900);
    });

    it('handles 0 active days as 0 centavos', () => {
      expect(calculateProration(99900, 0, 30)).toBe(0);
    });

    it('applies standard half-up rounding on fractional centavos', () => {
      // 1000 centavos / 3 days = 333.333 -> 333
      expect(calculateProration(1000, 1, 3)).toBe(333);
      // 2000 centavos / 3 days = 666.666 -> 667
      expect(calculateProration(2000, 1, 3)).toBe(667);
    });
  });
});
