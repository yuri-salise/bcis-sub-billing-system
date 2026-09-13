import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { FastifyInstance } from 'fastify';
import { pool } from '../src/db/client.js';

describe('Fastify API Server Health & Base Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  it('GET /health returns HTTP 200 and confirms database connectivity', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe('ok');
    expect(payload.database).toBe('connected');
    expect(payload.version).toBe('1.0.0');
    expect(typeof payload.uptimeSeconds).toBe('number');
    expect(typeof payload.databaseLatencyMs).toBe('number');
    expect(payload.databaseLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/v1/health returns versioned health probe response', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.payload);
    expect(payload.status).toBe('ok');
    expect(payload.database).toBe('connected');
  });

  it('GET /api/v1/unknown returns RFC 7807 error envelope with 404', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/unknown',
    });

    expect(response.statusCode).toBe(404);
    const payload = JSON.parse(response.payload);
    expect(payload.statusCode).toBe(404);
    expect(payload.error).toBe('Not Found');
    expect(payload.message).toContain('Route GET:/api/v1/unknown not found');
    expect(typeof payload.timestamp).toBe('string');
  });
});
