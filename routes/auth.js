const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/authMiddleware');
const sendEmail = require('../utils/sendEmail');


// UTILITY: Generate Random Token 
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}


// ─── @route   POST /api/auth/register
//     @desc    Register a new user & send verification email
//     @access  Public
router.post(
  '/register',
  [
    body('name', 'Name is required').notEmpty(),
    body('email', 'Valid email is required').isEmail(),
    body('password', 'Password must be 6+ chars').isLength({ min: 6 }),
    body('mobile', 'Mobile number is required').notEmpty()
  ],
  async (req, res) => {
    // 1. Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, mobile } = req.body;
    try {
      // Check if user already exists
      let user = await User.findOne({ email });
      if (user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'User already exists' }] });
      }

      // Create new user (not yet verified)
      user = new User({
        name,
        email,
        password,
        mobile,
        isVerified: false
      });

      // Hash password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);

      // Generate email verification token & expiry (24h)
      const emailToken = generateToken();
      user.emailVerificationToken = emailToken;
      user.emailVerificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      // for testin purpose
      // user.emailVerificationTokenExpires = Date.now() + 3 * 60 * 1000; // 24 hours
      
      // 6. Save user to the database
      await user.save();

      // 7. Send verification email
      const verifyURL = `${process.env.CLIENT_URL}/verify-email?token=${emailToken}`;
      const message = `
        <h1>Email Verification</h1>
        <p>Hi ${name},</p>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verifyURL}">${verifyURL}</a>
        <p>This link will expire in 24 hours.</p>
      `;
      await sendEmail({
        to: email,
        subject: 'Verify Your Email',
        html: message
      });
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
//     @desc    Verify the user’s email using token
//     @access  Public
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

    // Mark as verified and reset token
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
//     @desc    Send a fresh email‐verification link
//     @access  Public
router.post(
  '/resend-verification',
  [ body('email', 'Valid email is required').isEmail() ],
  async (req, res) => {
    //Validate
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email } = req.body;

    try {
      //Fetch user & ensure not already verified
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ msg: 'No account with that email found.' });
      }
      if (user.isVerified) {
        return res.status(400).json({ msg: 'Email is already verified.' });
      }

      //Create new token + expiry
      const emailToken = generateToken();
      user.emailVerificationToken = emailToken;
      user.emailVerificationTokenExpires = Date.now() + 24*60*60*1000; //1 hr
      await user.save();

      //Send email pointing at your front end
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


module.exports = router;
