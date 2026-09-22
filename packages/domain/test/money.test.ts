import { describe, it, expect } from 'vitest';
import {
  parseCurrencyToCentavos,
  formatCurrency,
  centavosToPesos,
  calculateProration,
  calculateActivationProration,
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

    it('handles undefined or null gracefully by defaulting to ₱0.00', () => {
      expect(formatCurrency(undefined)).toBe('₱0.00');
      expect(formatCurrency(null)).toBe('₱0.00');
      expect(formatCurrency()).toBe('₱0.00');
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

  describe('calculateActivationProration', () => {
    it('returns full rate without proration if activated on or before period start', () => {
      const res = calculateActivationProration(99900, '2026-09-01', '2026-09-30', '2026-08-15');
      expect(res.isProrated).toBe(false);
      expect(res.activeDays).toBe(30);
      expect(res.totalDays).toBe(30);
      expect(res.proratedAmountCentavos).toBe(99900);

      const resOnStart = calculateActivationProration(99900, '2026-09-01', '2026-09-30', '2026-09-01');
      expect(resOnStart.isProrated).toBe(false);
      expect(resOnStart.proratedAmountCentavos).toBe(99900);
    });

    it('correctly prorates when activated mid-period', () => {
      // Activated on Sept 16, 2026 in 30-day period: 15 active days (16 to 30)
      const res = calculateActivationProration(99900, '2026-09-01', '2026-09-30', '2026-09-16');
      expect(res.isProrated).toBe(true);
      expect(res.activeDays).toBe(15);
      expect(res.totalDays).toBe(30);
      expect(res.proratedAmountCentavos).toBe(49950);
    });

    it('returns 0 amount if activation is after period end', () => {
      const res = calculateActivationProration(99900, '2026-09-01', '2026-09-30', '2026-10-01');
      expect(res.isProrated).toBe(true);
      expect(res.activeDays).toBe(0);
      expect(res.proratedAmountCentavos).toBe(0);
    });

    it('rejects negative monthlyRecurringCentavos with an Error', () => {
      expect(() =>
        calculateActivationProration(-1000, '2026-09-01', '2026-09-30', '2026-09-15')
      ).toThrowError(/cannot be negative/);
    });

    it('handles ISO strings with whitespace cleanly', () => {
      const res = calculateActivationProration(99900, ' 2026-09-01 ', '2026-09-30T00:00:00Z', ' 2026-09-16 ');
      expect(res.isProrated).toBe(true);
      expect(res.activeDays).toBe(15);
      expect(res.proratedAmountCentavos).toBe(49950);
    });
  });
});

