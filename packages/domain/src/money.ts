/**
 * Monetary utility functions operating strictly in integer centavos.
 * 1 Philippine Peso (PHP / ₱) = 100 Centavos.
 */

/**
 * Converts a standard decimal string (e.g. "999.00", "1,499.50") into integer centavos.
 * Disallows floating point representation errors.
 */
export function parseCurrencyToCentavos(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`Float values are not allowed directly in parseCurrencyToCentavos: received ${value}. Pass centavos or string.`);
    }
    return value;
  }

  const cleaned = value.replace(/[₱,\s]/g, '').trim();
  if (!cleaned) return 0;

  const parts = cleaned.split('.');
  if (parts.length > 2) {
    throw new Error(`Invalid currency string: ${value}`);
  }

  const pesos = parseInt(parts[0] || '0', 10);
  if (isNaN(pesos)) {
    throw new Error(`Invalid currency number in string: ${value}`);
  }

  let centavos = 0;
  if (parts.length === 2) {
    const dec = parts[1].padEnd(2, '0').slice(0, 2);
    centavos = parseInt(dec, 10);
    if (isNaN(centavos)) {
      throw new Error(`Invalid centavos fraction: ${value}`);
    }
  }

  return pesos * 100 + centavos;
}

/**
 * Formats integer centavos to a standardized Philippine Peso currency string.
 * Example: 99900 => "₱999.00", 149950 => "₱1,499.50"
 */
export function formatCurrency(centavos?: number | null): string {
  if (centavos === undefined || centavos === null) {
    return '₱0.00';
  }

  if (!Number.isInteger(centavos)) {
    throw new Error(`formatCurrency requires an integer centavo count; received ${centavos}`);
  }

  const isNegative = centavos < 0;
  const absCentavos = Math.abs(centavos);
  const pesos = Math.floor(absCentavos / 100);
  const remainder = absCentavos % 100;

  const formattedPesos = pesos.toLocaleString('en-PH');
  const formattedCentavos = remainder.toString().padStart(2, '0');

  return `${isNegative ? '-' : ''}₱${formattedPesos}.${formattedCentavos}`;
}

/**
 * Converts integer centavos to decimal pesos representation for reporting exports.
 */
export function centavosToPesos(centavos: number): number {
  if (!Number.isInteger(centavos)) {
    throw new Error(`centavosToPesos requires an integer; received ${centavos}`);
  }
  return centavos / 100;
}

/**
 * Calculates prorated subscription charge using commercial Half-Up Rounding.
 * Formula: RoundHalfUp((MRC * activeDays) / totalDaysInPeriod)
 *
 * @param monthlyRecurringCentavos Monthly plan charge in centavos
 * @param activeDays Number of active days in the billing cycle
 * @param totalDaysInMonth Total calendar days in the billing cycle
 */
export function calculateProration(
  monthlyRecurringCentavos: number,
  activeDays: number,
  totalDaysInMonth: number
): number {
  if (totalDaysInMonth <= 0) {
    throw new Error('Total days in month must be greater than zero');
  }
  if (activeDays < 0 || activeDays > totalDaysInMonth) {
    throw new Error(`Active days (${activeDays}) must be between 0 and total days (${totalDaysInMonth})`);
  }

  // Exact half-up rounding on integer centavos
  const unrounded = (monthlyRecurringCentavos * activeDays) / totalDaysInMonth;
  return Math.round(unrounded);
}

/**
 * Calculates prorated subscription charge based on service activation date within a billing period.
 * If activation occurred on or before period start, no proration (full monthly rate).
 * If activation occurred within the period (activationDate > periodStart && activationDate <= periodEnd),
 * active days = (periodEnd - activationDate + 1), total days = (periodEnd - periodStart + 1).
 */
export function calculateActivationProration(
  monthlyRecurringCentavos: number,
  periodStartStr: string,
  periodEndStr: string,
  activationDateStr: string
): { activeDays: number; totalDays: number; proratedAmountCentavos: number; isProrated: boolean } {
  if (monthlyRecurringCentavos < 0) {
    throw new Error('Monthly recurring centavos cannot be negative');
  }

  function parseDateToUtcMs(str: string): number {
    const clean = str.split('T')[0].trim();
    const parts = clean.split('-').map((p) => parseInt(p, 10));
    if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
      throw new Error(`Invalid date format: ${str}. Expected YYYY-MM-DD.`);
    }
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }

  const startMs = parseDateToUtcMs(periodStartStr);
  const endMs = parseDateToUtcMs(periodEndStr);
  const actMs = parseDateToUtcMs(activationDateStr);

  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays = Math.round((endMs - startMs) / msPerDay) + 1;

  if (totalDays <= 0) {
    throw new Error('Billing period end must be after or equal to billing period start');
  }

  // If activated before or at the start of the billing period: full period
  if (actMs <= startMs) {
    return {
      activeDays: totalDays,
      totalDays,
      proratedAmountCentavos: monthlyRecurringCentavos,
      isProrated: false,
    };
  }

  // If activated after billing period ends: not active in this cycle
  if (actMs > endMs) {
    return {
      activeDays: 0,
      totalDays,
      proratedAmountCentavos: 0,
      isProrated: true,
    };
  }

  const activeDays = Math.round((endMs - actMs) / msPerDay) + 1;
  const proratedAmountCentavos = calculateProration(monthlyRecurringCentavos, activeDays, totalDays);

  return {
    activeDays,
    totalDays,
    proratedAmountCentavos,
    isProrated: true,
  };
}
