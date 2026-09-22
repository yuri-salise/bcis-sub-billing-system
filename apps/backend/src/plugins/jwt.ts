import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { AuthTokenPayload } from '@bcis/shared-types';

// In-memory token revocation blacklist (token -> expiration timestamp)
const revokedTokens = new Map<string, number>();

/**
 * Revokes an active JWT token so it cannot be used again.
 */
export function revokeToken(token: string, expiresAtMs?: number): void {
  const now = Date.now();
  // Prune expired entries to keep memory bounded
  for (const [t, exp] of revokedTokens.entries()) {
    if (now > exp) {
      revokedTokens.delete(t);
    }
  }
  const expiry = expiresAtMs || now + 8 * 60 * 60 * 1000;
  revokedTokens.set(token, expiry);
}

/**
 * Checks whether a token has been revoked.
 */
export function isTokenRevoked(token: string): boolean {
  const expiry = revokedTokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    revokedTokens.delete(token);
    return false;
  }
  return true;
}

/**
 * Clears revoked tokens cache (useful for test resets).
 */
export function clearRevokedTokens(): void {
  revokedTokens.clear();
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthTokenPayload;
    user: AuthTokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function jwtPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'MISSING_TOKEN',
        message: 'Authentication required: missing Bearer token',
        timestamp: new Date().toISOString(),
      });
    }

    const token = authHeader.substring(7).trim();
    if (isTokenRevoked(token)) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'TOKEN_REVOKED',
        message: 'Token has been revoked',
        timestamp: new Date().toISOString(),
      });
    }

    try {
      await request.jwtVerify();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid or expired token';
      const isExpired = message.includes('expired');
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: isExpired ? 'Token has expired' : 'Invalid token signature',
        timestamp: new Date().toISOString(),
      });
    }
  });
}

export default fp(jwtPlugin, {
  name: 'jwt-auth-plugin',
});
