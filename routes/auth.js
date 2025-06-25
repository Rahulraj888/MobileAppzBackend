import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';

import User from '../models/User.js';
import auth from '../middleware/authMiddleware.js';
import sendEmail from '../utils/sendEmail.js';

const router = express.Router();

// UTILITY: Generate Random Token 
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── @route   POST /api/auth/register
router.post(
  '/register',
  [
    body('name', 'Name is required').notEmpty(),
    body('email', 'Valid email is required').isEmail(),
    body('password', 'Password must be 6+ chars').isLength({ min: 6 }),
    body('mobile', 'Mobile number is required').notEmpty()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, mobile } = req.body;
    try {
      let user = await User.findOne({ email });
      if (user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'User already exists' }] });
      }

      user = new User({ name, email, password, mobile, isVerified: false });

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);

      const emailToken = generateToken();
      user.emailVerificationToken = emailToken;
      user.emailVerificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;

      await user.save();

      const verifyURL = `${process.env.CLIENT_URL}/verify-email?token=${emailToken}`;
      const message = `
        <h1>Email Verification</h1>
        <p>Hi ${name},</p>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verifyURL}">${verifyURL}</a>
        <p>This link will expire in 24 hours.</p>
      `;
      await sendEmail({ to: email, subject: 'Verify Your Email', html: message });

      res
        .status(201)
        .json({ msg: 'Registration successful! Please check your email to verify.' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// ─── @route   GET /api/auth/verify-email
router.get('/verify-email', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ msg: 'No token provided' });

  try {
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationTokenExpires: { $gt: Date.now() }
    });
    if (!user) {
      return res.status(400).json({ msg: 'Token is invalid or expired.' });
    }

    user.isVerified = true;
    user.verifiedAt = Date.now();
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpires = undefined;
    await user.save();

    res.json({ msg: 'Email successfully verified! You can now log in.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// ─── @route   POST /api/auth/resend-verification
router.post(
  '/resend-verification',
  [ body('email', 'Valid email is required').isEmail() ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(400).json({ msg: 'No account with that email found.' });
      if (user.isVerified) {
        return res.status(400).json({ msg: 'Email is already verified. Please proceed to Login' });
      }

      const emailToken = generateToken();
      user.emailVerificationToken = emailToken;
      user.emailVerificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save();

      const link = `${process.env.CLIENT_URL}/verify-email?token=${emailToken}`;
      const html = `
        <h1>Verify your email again</h1>
        <p>Click below to verify:</p>
        <a href="${link}">${link}</a>
      `;
      await sendEmail({ to: email, subject: 'Resend Verification', html });

      res.json({ msg: 'Verification email resent. Check your inbox.' });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  }
);

// ─── @route   POST /api/auth/login
router.post(
  '/login',
  [
    body('email', 'Please include a valid email').isEmail(),
    body('password', 'Password is required').exists()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Account is not registered. Please register your account' }] });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ errors: [{ msg: 'Invalid credentials' }] });
      }

      if (user.role !== 'admin' && !user.isVerified) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Please verify your email before logging in.' }] });
      }

      const payload = { user: { id: user.id, role: user.role } };
      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '2h' },
        (err, token) => {
          if (err) throw err;
          res.json({ token });
        }
      );
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// ─── @route   POST /api/auth/forgot-password
router.post(
  '/forgot-password',
  [ body('email', 'Please include a valid email').isEmail() ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ errors: [{ msg: 'No account with that email found.' }] });
      }
      if (!user.isVerified) {
        return res.status(400).json({ errors: [{ msg: 'Email not verified. Cannot reset password.' }] });
      }

      const resetToken = generateToken();
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 1 * 60 * 60 * 1000;
      await user.save();

      const resetURL = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
      const message = `
        <h1>Password Reset</h1>
        <p>Hi ${user.name},</p>
        <p>You requested a password reset. Click the link below to set a new password:</p>
        <a href="${resetURL}">${resetURL}</a>
        <p>If you did not request this, please ignore this email. This link expires in 1 hour.</p>
      `;
      await sendEmail({ to: email, subject: 'Password Reset Request', html: message });

      res.json({ msg: 'Password reset email sent. Check your inbox.' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// ─── @route   POST /api/auth/reset-password
router.post(
  '/reset-password',
  [ body('password', 'Password must be 6+ chars').isLength({ min: 6 }) ],
  async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).json({ msg: 'No token provided' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() }
      });
      if (!user) return res.status(400).json({ msg: 'Token is invalid or expired.' });

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(req.body.password, salt);

      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      res.json({ msg: 'Password has been reset. You can now log in.' });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// ─── @route   POST /api/auth/change-password
router.post(
  '/change-password',
  auth,
  [
    body('currentPassword', 'Current password is required').exists(),
    body('newPassword', 'New password must be 6+ chars').isLength({ min: 6 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { currentPassword, newPassword } = req.body;
    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ msg: 'User not found' });

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ errors: [{ msg: 'Current password is incorrect' }] });
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
      await user.save();

      res.json({ msg: 'Password changed successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  }
);

// ─── @route   GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// ─── @route   PUT /api/auth/me
router.put(
  '/me',
  auth,
  [
    body('name', 'Name is required').optional().notEmpty(),
    body('mobile', 'Mobile must be 10 digits').optional().isLength({ min: 10, max: 10 }),
    body('bio', 'Bio must be under 500 characters').optional().isLength({ max: 500 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const updates = {};
      ['name', 'mobile', 'bio'].forEach(field => {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      });

      const user = await User.findByIdAndUpdate(
        req.user.id,
        { $set: updates },
        { new: true, runValidators: true }
      ).select('-password');

      if (!user) return res.status(404).json({ msg: 'User not found' });
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  }
);

export default router;
