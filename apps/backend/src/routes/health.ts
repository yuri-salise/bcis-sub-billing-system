import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { checkDatabaseConnection } from '../db/client.js';
import { HealthStatusResponse } from '@bcis/shared-types';

export const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const handleHealth = async (_request: any, reply: any) => {
    const dbStatus = await checkDatabaseConnection();

    const statusCode = dbStatus.ok ? 200 : 503;
    const response: HealthStatusResponse = {
      status: dbStatus.ok ? 'ok' : 'degraded',
      database: dbStatus.ok ? 'connected' : 'disconnected',
      version: '1.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return reply.status(statusCode).send({
      ...response,
      databaseLatencyMs: dbStatus.latencyMs,
      ...(dbStatus.error ? { databaseError: dbStatus.error } : {}),
    });
  };

  // Root health probe
  fastify.get('/health', handleHealth);

  // Versioned API health probe
  fastify.get('/api/v1/health', handleHealth);
};
