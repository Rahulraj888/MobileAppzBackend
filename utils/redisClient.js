import { createClient } from 'redis';

const redisClient = createClient(); // uses localhost:6379 by default
redisClient.on('error', err => console.error('Redis error:', err));

await redisClient.connect();
export default redisClient;
