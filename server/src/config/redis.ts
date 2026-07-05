import { createClient, RedisClientType } from 'redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let client: RedisClientType | null = null;

/**
 * Opens the Redis connection. Call once at server startup.
 * Subsequent calls return the existing client.
 */
export async function connectRedis(): Promise<RedisClientType> {
  if (client) return client;

  client = createClient({ url: REDIS_URL }) as RedisClientType;

  client.on('error', (err: Error) => {
    console.error('[Redis] Client error:', err.message);
  });

  await client.connect();
  console.log('[Redis] Connected successfully.');
  return client;
}

/** Returns the shared Redis client. Throws if connectRedis() hasn't been called. */
export function getRedisClient(): RedisClientType {
  if (!client) {
    throw new Error('Redis client not initialised — call connectRedis() first.');
  }
  return client;
}
