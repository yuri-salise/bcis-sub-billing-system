import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { healthRoutes } from './routes/health.js';
import jwtPlugin from './plugins/jwt.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { userRoutes } from './modules/users/users.routes.js';

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

  // Register JWT authentication and session plugin
  server.register(jwtPlugin);

  // Register health check endpoints
  server.register(healthRoutes);

  // Register application routes
  server.register(authRoutes, { prefix: '/api/v1/auth' });
  server.register(userRoutes, { prefix: '/api/v1/users' });

  // 404 Not Found handler adhering to RFC 7807 unified envelope
  server.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: `Route ${request.method}:${request.url} not found`,
      timestamp: new Date().toISOString(),
    });
  });

  // Global error handler adhering to RFC 7807 unified envelope
  server.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: number; name?: string; message?: string; code?: string };
    const statusCode = err.statusCode || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    return reply.status(statusCode).send({
      statusCode,
      error: err.name || 'Internal Server Error',
      code: err.code || (isClientError ? 'CLIENT_ERROR' : 'INTERNAL_ERROR'),
      message: isClientError ? (err.message || 'Client Error') : 'An unexpected error occurred on the server',
      timestamp: new Date().toISOString(),
    });
  });

  return server;
}
