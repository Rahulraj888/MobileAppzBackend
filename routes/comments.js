import express from 'express';
import { body, param, validationResult } from 'express-validator';
import asyncHandler from '../middleware/asyncHandler.js';
import auth from '../middleware/authMiddleware.js';
import Comment from '../models/Comment.js';

const router = express.Router();

// Middleware to check express-validator results
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

/**
 * PUT /api/comments/:id
 * Edit one’s own comment
 */
router.put(
  '/:id',
  auth,
  [
    param('id', 'Invalid comment ID').isMongoId(),
    body('text', 'Comment text is required').trim().notEmpty()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { text } = req.body;

    // Find the comment
    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({ msg: 'Comment not found' });
    }

    // Authorization: only author can edit
    if (comment.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    // Apply update
    comment.text = text;
    comment.updatedAt = Date.now();
    await comment.save();

    // Re-populate user name
    await comment.populate('user', 'name');

    res.json(comment);
  })
);

/**
 * DELETE /api/comments/:id
 * Delete one’s own comment
 */
router.delete(
  '/:id',
  auth,
  [ param('id', 'Invalid comment ID').isMongoId() ],
  validate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({ msg: 'Comment not found' });
    }

    if (comment.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    await comment.deleteOne();
    res.json({ msg: 'Comment deleted' });
  })
);

export default router;
