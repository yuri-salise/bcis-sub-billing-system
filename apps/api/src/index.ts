import { buildServer } from './server.js';
import { env } from './config/env.js';

async function start() {
  const server = buildServer();

  try {
    await server.listen({ host: env.API_HOST, port: env.API_PORT });
    console.log(`
============================================================
  BCIS Subscription Billing and Collection System — API Server
  LAN Address: http://${env.API_HOST}:${env.API_PORT}
  Environment: ${env.NODE_ENV}
============================================================
    `);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Start server
start();
