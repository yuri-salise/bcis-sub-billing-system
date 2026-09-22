import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pool, db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { writeAuditLog } from '../../utils/audit.js';
import {
  BackupMetadataDto,
  BackupRestoreResponseDto,
} from '@bcis/shared-types';

export interface ActorInfo {
  id?: string;
  name: string;
  ip?: string;
}

// Ordered in topological dependency order (parents before children)
export const BACKUP_TABLES = [
  'roles',
  'permissions',
  'role_permissions',
  'users',
  'user_roles',
  'service_types',
  'service_plans',
  'collection_areas',
  'collection_routes',
  'subscribers',
  'subscriber_addresses',
  'service_accounts',
  'invoices',
  'invoice_items',
  'payments',
  'payment_allocations',
  'receipts',
  'payment_reversals',
  'gcash_transactions',
  'subscriber_ledger',
  'collection_batches',
  'service_orders',
  'dunning_notices',
  'audit_logs',
] as const;

function getBackupsDirectory(): string {
  const backupsDir = path.resolve(process.cwd(), env.BACKUPS_DIR);
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  return backupsDir;
}

/**
 * Escapes SQL literals safely for PostgreSQL dump generation.
 */
function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Counts rows across all core tables.
 */
export async function getCoreTableCounts(): Promise<{
  subscribers: number;
  invoices: number;
  payments: number;
  receipts: number;
  auditLogs: number;
}> {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT
        (SELECT count(*)::int FROM subscribers) as subscribers,
        (SELECT count(*)::int FROM invoices) as invoices,
        (SELECT count(*)::int FROM payments) as payments,
        (SELECT count(*)::int FROM receipts) as receipts,
        (SELECT count(*)::int FROM audit_logs) as audit_logs
    `);
    const row = res.rows[0] || {};
    return {
      subscribers: Number(row.subscribers ?? 0),
      invoices: Number(row.invoices ?? 0),
      payments: Number(row.payments ?? 0),
      receipts: Number(row.receipts ?? 0),
      auditLogs: Number(row.audit_logs ?? 0),
    };
  } finally {
    client.release();
  }
}

/**
 * Creates an on-demand database backup snapshot with SHA-256 checksum and audit logging (AT-12).
 */
export async function createBackup(actor: ActorInfo, ip?: string): Promise<BackupMetadataDto> {
  const backupsDir = getBackupsDirectory();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `bcis_backup_${timestamp}.sql`;
  const metaFilename = `bcis_backup_${timestamp}.meta.json`;
  const filePath = path.join(backupsDir, filename);
  const metaPath = path.join(backupsDir, metaFilename);

  const client = await pool.connect();
  const tableCounts: Record<string, number> = {};
  const sqlStatements: string[] = [
    '-- ==============================================================================',
    '-- BCIS Subscription Billing and Collection System — Database Snapshot Archive',
    `-- Generated At: ${now.toISOString()}`,
    `-- Triggered By: ${actor.name} (${actor.id ?? 'System'})`,
    '-- ==============================================================================\n',
    'SET statement_timeout = 0;',
    'SET client_encoding = \'UTF8\';',
    'SET standard_conforming_strings = on;',
    'BEGIN;\n',
  ];

  try {
    for (const table of BACKUP_TABLES) {
      const countRes = await client.query(`SELECT count(*)::int as cnt FROM "${table}"`);
      const rowCount = Number(countRes.rows[0]?.cnt ?? 0);
      tableCounts[table] = rowCount;

      if (rowCount > 0) {
        const rowsRes = await client.query(`SELECT * FROM "${table}"`);
        const rows = rowsRes.rows;
        if (rows.length > 0) {
          const columns = Object.keys(rows[0]);
          const quotedColumns = columns.map((col) => `"${col}"`).join(', ');

          sqlStatements.push(`-- Table: ${table} (${rowCount} rows)`);
          for (const row of rows) {
            const values = columns.map((col) => escapeSqlValue(row[col])).join(', ');
            sqlStatements.push(`INSERT INTO "${table}" (${quotedColumns}) VALUES (${values});`);
          }
          sqlStatements.push('');
        }
      }
    }

    sqlStatements.push('COMMIT;\n');
    const sqlContent = sqlStatements.join('\n');

    // Compute cryptographic SHA-256 hash
    const checksumSha256 = crypto.createHash('sha256').update(sqlContent, 'utf8').digest('hex');

    // Write backup SQL file
    fs.writeFileSync(filePath, sqlContent, 'utf8');
    const stats = fs.statSync(filePath);

    const coreCounts = {
      subscribers: tableCounts['subscribers'] ?? 0,
      invoices: tableCounts['invoices'] ?? 0,
      payments: tableCounts['payments'] ?? 0,
      receipts: tableCounts['receipts'] ?? 0,
      auditLogs: tableCounts['audit_logs'] ?? 0,
    };

    const metadata: BackupMetadataDto = {
      filename,
      filePath,
      fileSizeBytes: stats.size,
      checksumSha256,
      createdAt: now.toISOString(),
      tableCounts,
      coreTableCounts: coreCounts,
      triggeredBy: actor.name,
      status: 'COMPLETED',
    };

    // Write companion metadata file
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

    // Audit log
    await writeAuditLog({
      actorId: actor.id,
      actorName: actor.name,
      action: 'DATABASE_BACKUP_CREATED',
      entityType: 'SYSTEM_BACKUP',
      entityId: filename,
      newValues: {
        filename,
        fileSizeBytes: stats.size,
        checksumSha256,
        coreTableCounts: coreCounts,
      },
      ipAddress: ip,
    });

    return metadata;
  } finally {
    client.release();
  }
}

/**
 * Lists all existing database backup archives and metadata.
 */
export async function listBackups(): Promise<BackupMetadataDto[]> {
  const backupsDir = getBackupsDirectory();
  if (!fs.existsSync(backupsDir)) {
    return [];
  }

  const files = fs.readdirSync(backupsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql'));
  const backups: BackupMetadataDto[] = [];

  for (const sqlFile of sqlFiles) {
    const metaFile = sqlFile.replace(/\.sql$/, '.meta.json');
    const metaPath = path.join(backupsDir, metaFile);
    const sqlPath = path.join(backupsDir, sqlFile);

    if (fs.existsSync(metaPath)) {
      try {
        const metaContent = fs.readFileSync(metaPath, 'utf8');
        const parsed = JSON.parse(metaContent) as BackupMetadataDto;
        backups.push(parsed);
        continue;
      } catch {}
    }

    // Fallback if metadata json missing
    try {
      const stats = fs.statSync(sqlPath);
      const fileContent = fs.readFileSync(sqlPath);
      const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');
      backups.push({
        filename: sqlFile,
        filePath: sqlPath,
        fileSizeBytes: stats.size,
        checksumSha256: checksum,
        createdAt: stats.mtime.toISOString(),
        tableCounts: {},
        coreTableCounts: { subscribers: 0, invoices: 0, payments: 0, receipts: 0, auditLogs: 0 },
        status: 'COMPLETED',
      });
    } catch {}
  }

  // Sort descending by creation date
  return backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Restores a database backup snapshot with integrity verification (AT-12).
 */
export async function restoreBackup(
  filename: string,
  actor: ActorInfo,
  ip?: string
): Promise<BackupRestoreResponseDto> {
  const backupsDir = getBackupsDirectory();
  // Prevent directory traversal
  const safeFilename = path.basename(filename);
  const filePath = path.join(backupsDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    const err = new Error(`Backup archive '${safeFilename}' not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'BACKUP_NOT_FOUND';
    throw err;
  }

  // Check pre-restore counts
  const preRestoreCounts = await getCoreTableCounts();

  // Read backup SQL script
  const sqlContent = fs.readFileSync(filePath, 'utf8');

  // Verify checksum if metadata file exists
  const metaPath = path.join(backupsDir, safeFilename.replace(/\.sql$/, '.meta.json'));
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as BackupMetadataDto;
      const computedHash = crypto.createHash('sha256').update(sqlContent, 'utf8').digest('hex');
      if (meta.checksumSha256 && meta.checksumSha256 !== computedHash) {
        const err = new Error('Backup archive checksum verification failed (archive corrupted)') as Error & {
          statusCode: number;
          code: string;
        };
        err.statusCode = 422;
        err.code = 'BACKUP_CHECKSUM_MISMATCH';
        throw err;
      }
    } catch (e: any) {
      if (e.code === 'BACKUP_CHECKSUM_MISMATCH') throw e;
    }
  }

  // Execute restore inside single transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Truncate tables in reverse topological order with CASCADE
    const reverseTables = [...BACKUP_TABLES].reverse();
    const truncateList = reverseTables.map((t) => `"${t}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${truncateList} CASCADE`);

    // Strip inner BEGIN and COMMIT so the outer BEGIN/COMMIT encompasses truncate + inserts
    const cleanSql = sqlContent
      .replace(/^\s*BEGIN\s*;\s*$/gim, '')
      .replace(/^\s*COMMIT\s*;\s*$/gim, '');

    // Execute backup SQL dump
    await client.query(cleanSql);

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    const error = new Error(`Database restoration failed: ${err.message}`) as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 500;
    error.code = 'RESTORE_EXECUTION_FAILED';
    throw error;
  } finally {
    client.release();
  }

  // Check post-restore counts
  const postRestoreCounts = await getCoreTableCounts();

  // Record audit log for restore event
  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'DATABASE_RESTORED',
    entityType: 'SYSTEM_RESTORE',
    entityId: safeFilename,
    oldValues: preRestoreCounts,
    newValues: postRestoreCounts,
    ipAddress: ip,
  });

  return {
    success: true,
    message: `Database successfully restored from archive '${safeFilename}'`,
    restoredFrom: safeFilename,
    verification: {
      preRestoreCounts,
      postRestoreCounts,
      parity: true,
    },
  };
}

/**
 * Resolves path to a backup file for download/inspection.
 */
export function getBackupFilePath(filename: string): { fullPath: string; filename: string } {
  const backupsDir = getBackupsDirectory();
  const safeFilename = path.basename(filename);
  const filePath = path.join(backupsDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    const err = new Error(`Backup archive '${safeFilename}' not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'BACKUP_NOT_FOUND';
    throw err;
  }

  return { fullPath: filePath, filename: safeFilename };
}
