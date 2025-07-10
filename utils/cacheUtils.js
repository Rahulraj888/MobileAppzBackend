import redisClient from './redisClient.js';

// Delete all report cache keys for a given user
export async function invalidateUserReportCache(userId) {
  const types = ['all', 'Pothole', 'Streetlight', 'Graffiti', 'Other'];
  const keys = types.map(type => `reports:all:${type}:user:${userId}`);
  keys.push(`reports:all:all:user:${userId}`);
  await Promise.all(keys.map(key => redisClient.del(key)));
}