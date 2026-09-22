/**
 * Formats data into standard RFC 4180 CSV string with proper quotes and CRLF line breaks.
 * Mitigates CSV Formula Injection (DDE attacks) for MS Excel / desktop spreadsheet viewers.
 */
export function toCsvString(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escapeCell = (val: any): string => {
    if (val === null || val === undefined) return '';
    let str = String(val);

    // CSV Formula Injection mitigation:
    // If a string starts with =, +, @, \t, \r, or a minus followed by a non-digit, prefix with single quote
    if (typeof val === 'string') {
      const trimmed = str.trimStart();
      if (
        trimmed.startsWith('=') ||
        trimmed.startsWith('+') ||
        trimmed.startsWith('@') ||
        trimmed.startsWith('\t') ||
        trimmed.startsWith('\r') ||
        (trimmed.startsWith('-') && isNaN(Number(trimmed)))
      ) {
        str = `'${str}`;
      }
    }

    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.map(escapeCell).join(',');
  const rowLines = rows.map((r) => r.map(escapeCell).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}
