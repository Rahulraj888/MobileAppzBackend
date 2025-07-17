import express from 'express';
import asyncHandler from '../middleware/asyncHandler.js';
import redisClient from '../utils/redisClient.js';

const router = express.Router();

/**
 * GET /api/redis/ping-redis
 * Simple endpoint to test Redis connectivity
 */
router.get(
  '/ping-redis',
  asyncHandler(async (req, res) => {
    try {
      await redisClient.set('testkey', 'Hello Redis!');
      const val = await redisClient.get('testkey');
      res.json({ msg: `Redis says: ${val}` });
    } catch (err) {
      console.error('Redis ping error:', err);
      res.status(500).json({ msg: 'Redis is not reachable' });
    }
  })
);

export default router;
