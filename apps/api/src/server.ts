import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.js';

export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // Enable CORS for LAN office workstations
  server.register(cors, {
    origin: env.API_CORS_ORIGIN === '*' ? true : env.API_CORS_ORIGIN.split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Register health check endpoints
  server.register(healthRoutes);

  // 404 Not Found handler adhering to RFC 7807 unified envelope
  server.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
      timestamp: new Date().toISOString(),
    });
  });

  // Global error handler adhering to RFC 7807 unified envelope
  server.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: number; name?: string; message?: string };
    const statusCode = err.statusCode || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    return reply.status(statusCode).send({
      statusCode,
      error: err.name || 'Internal Server Error',
      message: isClientError ? (err.message || 'Client Error') : 'An unexpected error occurred on the server',
      timestamp: new Date().toISOString(),
    });
  });

  return server;
}
