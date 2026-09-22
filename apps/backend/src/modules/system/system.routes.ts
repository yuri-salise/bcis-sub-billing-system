import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { requirePermission } from '../../middleware/rbac.js';
import { extractActor } from '../../utils/audit.js';
import {
  createBackup,
  listBackups,
  restoreBackup,
  getBackupFilePath,
} from './system.service.js';
import { restoreBackupSchema } from '@bcis/validation';

export const systemRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * POST /api/v1/system/backup
   * Generates an on-demand database backup snapshot with SHA-256 checksum and audit logging.
   * Guarded by backup.create permission.
   */
  fastify.post(
    '/backup',
    { preHandler: [fastify.authenticate, requirePermission('backup.create')] },
    async (request, reply) => {
      const actor = extractActor(request);
      const backup = await createBackup(actor, request.ip);

      return reply.status(201).send({
        success: true,
        message: 'Database backup snapshot generated successfully',
        data: backup,
        backup,
      });
    }
  );

  /**
   * Alias: POST /api/v1/backup/create
   */
  fastify.post(
    '/backup/create',
    { preHandler: [fastify.authenticate, requirePermission('backup.create')] },
    async (request, reply) => {
      const actor = extractActor(request);
      const backup = await createBackup(actor, request.ip);

      return reply.status(201).send({
        success: true,
        message: 'Database backup snapshot generated successfully',
        data: backup,
        backup,
      });
    }
  );

  /**
   * GET /api/v1/system/backups
   * Lists all existing backup archives and metadata.
   * Guarded by backup.create or backup.restore permission.
   */
  fastify.get(
    '/backups',
    { preHandler: [fastify.authenticate, requirePermission(['backup.create', 'backup.restore'])] },
    async (_request, reply) => {
      const backups = await listBackups();
      return reply.status(200).send({
        data: backups,
        total: backups.length,
      });
    }
  );

  /**
   * POST /api/v1/system/restore
   * Restores database snapshot from an existing backup archive (AT-12).
   * Guarded by backup.restore permission.
   */
  fastify.post<{ Body: { filename: string } }>(
    '/restore',
    { preHandler: [fastify.authenticate, requirePermission('backup.restore')] },
    async (request, reply) => {
      const parseResult = restoreBackupSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_INPUT',
          message: 'Validation failed',
          details: parseResult.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      const result = await restoreBackup(parseResult.data.filename, actor, request.ip);

      return reply.status(200).send(result);
    }
  );

  /**
   * GET /api/v1/system/backups/:filename
   * Downloads a specific backup file.
   * Guarded by backup.create or backup.restore permission.
   */
  fastify.get<{ Params: { filename: string } }>(
    '/backups/:filename',
    { preHandler: [fastify.authenticate, requirePermission(['backup.create', 'backup.restore'])] },
    async (request, reply) => {
      const { filename } = request.params;
      const { fullPath, filename: safeName } = getBackupFilePath(filename);

      reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
      reply.header('Content-Type', 'application/sql');

      const stream = fs.createReadStream(fullPath);
      return reply.send(stream);
    }
  );
};
