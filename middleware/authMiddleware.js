import jwt from 'jsonwebtoken';

/**
 * Protect routes by validating a JWT.
 * Accepts either:
 *  - x-auth-token header: "the_token"
 *  - Authorization header: "Bearer the_token"
 */
export default function auth(req, res, next) {
  try {
    // Grab token from either header
    const authHeader = req.header('x-auth-token') || req.header('authorization');
    if (!authHeader) {
      return res.status(401).json({ msg: 'No token provided, authorization denied' });
    }

    // Support "Bearer <token>" or raw token
    let token = authHeader;
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    }

    if (!token) {
      return res.status(401).json({ msg: 'Token missing after Bearer' });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (verifyErr) {
      console.error('JWT verification failed:', verifyErr);
      return res.status(401).json({ msg: 'Token is not valid' });
    }

    // Expect payload to include .user
    if (!decoded || !decoded.user) {
      return res.status(401).json({ msg: 'Invalid token payload' });
    }

    req.user = decoded.user;
    next();

  } catch (err) {
    console.error('Authentication middleware error:', err);
    res.status(500).json({ msg: 'Server error during authentication' });
  }
}
