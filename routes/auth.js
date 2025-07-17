import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';

import User from '../models/User.js';
import auth from '../middleware/authMiddleware.js';
import sendEmail from '../utils/sendEmail.js';

const router = express.Router();

// UTILITY: Generate a secure random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/auth/register
// Registers a new user and sends a verification email.
router.post(
  '/register',
  [
    body('name', 'Name is required').notEmpty(),
    body('email', 'Valid email is required').isEmail(),
    body('password', 'Password must be at least 6 characters').isLength({ min: 6 }),
    body('mobile', 'Mobile number is required').notEmpty()
  ],
  async (req, res) => {
    // Validate inputs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, mobile } = req.body;
    try {
      // Prevent duplicate accounts
      if (await User.exists({ email })) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'User already exists' }] });
      }

      // Create and hash password
      const user = new User({ name, email, password, mobile, isVerified: false });
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);

      // Generate email verification token
      const emailToken = generateToken();
      user.emailVerificationToken = emailToken;
      user.emailVerificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24h

      await user.save();

      // Build verification link
      const verifyURL = `${process.env.CLIENT_URL}/verify-email?token=${emailToken}`;
      const html = `
        <h1>Email Verification</h1>
        <p>Hi ${name},</p>
        <p>Please <a href="${verifyURL}" target="_blank" rel="noopener noreferrer">click here</a> to verify your email address.</p>
        <p>If that doesn’t work, copy and paste this URL into your browser:</p>
        <p><a href="${verifyURL}" target="_blank" rel="noopener noreferrer">${verifyURL}</a></p>
        <p>This link will expire in 24 hours.</p>
      `;
      const text = `Hi ${name},\n\nPlease verify your email by visiting:\n\n${verifyURL}\n\nThis link expires in 24 hours.`;

      // Send email (failures here should not block registration)
      try {
        await sendEmail({ to: email, subject: 'Verify Your Email', html, text });
      } catch (emailErr) {
        console.error('Verification email failed:', emailErr);
      }

      res
        .status(201)
        .json({ msg: 'Registration successful! Please check your email to verify.' });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ msg: 'Server error during registration' });
    }
  }
);

// GET /api/auth/verify-email
// Verifies the email token.
router.get('/verify-email', async (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).json({ msg: 'No token provided' });
  }

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
    console.error('Verify-email error:', err);
    res.status(500).json({ msg: 'Server error during verification' });
  }
});

// POST /api/auth/resend-verification
// Resends the verification email.
router.post(
  '/resend-verification',
  [ body('email', 'Valid email is required').isEmail() ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ msg: 'No account with that email found.' });
      }
      if (user.isVerified) {
        return res
          .status(400)
          .json({ msg: 'Email is already verified. Please log in.' });
      }

      // Generate new token
      const emailToken = generateToken();
      user.emailVerificationToken = emailToken;
      user.emailVerificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save();

      // Build link and email body
      const verifyURL = `${process.env.CLIENT_URL}/verify-email?token=${emailToken}`;
      const html = `
        <h1>Verify Your Email (Again)</h1>
        <p>Please <a href="${verifyURL}" target="_blank" rel="noopener noreferrer">click here</a> to verify your email address.</p>
        <p>Or copy & paste this URL into your browser:</p>
        <p><a href="${verifyURL}" target="_blank" rel="noopener noreferrer">${verifyURL}</a></p>
      `;
      const text = `Please verify your email by visiting:\n\n${verifyURL}`;

      try {
        await sendEmail({ to: email, subject: 'Resend Verification', html, text });
      } catch (emailErr) {
        console.error('Resend-verification email failed:', emailErr);
      }

      res.json({ msg: 'Verification email resent. Check your inbox.' });
    } catch (err) {
      console.error('Resend-verification error:', err);
      res.status(500).json({ msg: 'Server error during resend' });
    }
  }
);

// POST /api/auth/login
// Authenticates and returns a JWT.
router.post(
  '/login',
  [
    body('email', 'Please include a valid email').isEmail(),
    body('password', 'Password is required').exists()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Account not registered. Please sign up.' }] });
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
      console.error('Login error:', err);
      res.status(500).json({ msg: 'Server error during login' });
    }
  }
);

// POST /api/auth/forgot-password
// Sends a password reset email.
router.post(
  '/forgot-password',
  [ body('email', 'Please include a valid email').isEmail() ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

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
      user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1h
      await user.save();

      const resetURL = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
      const html = `
        <h1>Password Reset</h1>
        <p>Hi ${user.name},</p>
        <p>You requested a password reset. <a href="${resetURL}" target="_blank" rel="noopener noreferrer">Click here</a> to set a new password.</p>
        <p>If that doesn’t work, paste this into your browser:</p>
        <p>${resetURL}</p>
        <p>This link expires in 1 hour.</p>
      `;
      const text = `Reset your password by visiting:\n\n${resetURL}`;

      try {
        await sendEmail({ to: email, subject: 'Password Reset Request', html, text });
      } catch (emailErr) {
        console.error('Forgot-password email failed:', emailErr);
      }

      res.json({ msg: 'Password reset email sent. Check your inbox.' });
    } catch (err) {
      console.error('Forgot-password error:', err);
      res.status(500).json({ msg: 'Server error during forgot-password' });
    }
  }
);

// POST /api/auth/reset-password
// Resets the password using the provided token.
router.post(
  '/reset-password',
  [ body('password', 'Password must be at least 6 characters').isLength({ min: 6 }) ],
  async (req, res) => {
    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ msg: 'No token provided' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() }
      });
      if (!user) {
        return res.status(400).json({ msg: 'Token is invalid or expired.' });
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(req.body.password, salt);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      res.json({ msg: 'Password has been reset. You can now log in.' });
    } catch (err) {
      console.error('Reset-password error:', err);
      res.status(500).json({ msg: 'Server error during password reset' });
    }
  }
);

// POST /api/auth/change-password
// Changes the password for a logged-in user.
router.post(
  '/change-password',
  auth,
  [
    body('currentPassword', 'Current password is required').exists(),
    body('newPassword', 'New password must be at least 6 characters').isLength({ min: 6 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ msg: 'User not found' });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ errors: [{ msg: 'Current password is incorrect' }] });
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
      await user.save();

      res.json({ msg: 'Password changed successfully' });
    } catch (err) {
      console.error('Change-password error:', err);
      res.status(500).json({ msg: 'Server error during password change' });
    }
  }
);

// GET /api/auth/me
// Returns the current logged-in user’s profile (excluding password).
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Get-me error:', err);
    res.status(500).json({ msg: 'Server error fetching profile' });
  }
});

// PUT /api/auth/me
// Updates the current user’s profile.
router.put(
  '/me',
  auth,
  [
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('mobile').optional().isLength({ min: 10, max: 10 }).withMessage('Mobile must be 10 digits'),
    body('bio').optional().isLength({ max: 500 }).withMessage('Bio must be under 500 characters')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

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

      if (!user) {
        return res.status(404).json({ msg: 'User not found' });
      }
      res.json(user);
    } catch (err) {
      console.error('Update-me error:', err);
      res.status(500).json({ msg: 'Server error updating profile' });
    }
  }
);

export default router;
