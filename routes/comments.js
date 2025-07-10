import express from 'express';
import Comment from '../models/Comment.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * PUT /api/comments/:id
 * Edit one’s own comment
 */
router.put('/:id', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ msg: 'Comment text is required' });
    }

    // Find the comment
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ msg: 'Comment not found' });
    }

    // Only the author may update
    if (comment.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    comment.text = text.trim();
    comment.updatedAt = Date.now();
    await comment.save();

    // Re-populate user name
    await comment.populate('user', 'name');

    res.json(comment);
  } catch (err) {
    console.error('Error updating comment:', err);
    res.status(500).json({ msg: 'Server error updating comment' });
  }
});

/**
 * DELETE /api/comments/:id
 * Delete one’s own comment
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ msg: 'Comment not found' });
    }

    // Only the author may delete
    if (comment.user.toString() !== req.user.id) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    await comment.deleteOne();
    res.json({ msg: 'Comment deleted' });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).json({ msg: 'Server error deleting comment' });
  }
});

export default router;
