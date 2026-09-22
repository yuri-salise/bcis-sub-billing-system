import dotenv from 'dotenv';
import { resolve } from 'path';
import { z } from 'zod';

// Load .env from root or local directory
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().default(4000),
  API_CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string().default('postgres://bcis_user:bcis_password@localhost:5432/bcis_billing_db'),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(20),
  JWT_SECRET: z.string().default('super-secret-bcis-jwt-token-key-change-in-production-min-32-chars'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  ATTACHMENTS_DIR: z.string().default('./data/attachments'),
  BACKUPS_DIR: z.string().default('./data/backups'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format());
    throw new Error('Invalid environment variables');
  }
  return result.data;
}

export const env = loadEnv();
