/**
 * Ensure that the authenticated user has admin privileges.
 */
export function checkAdmin(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ msg: 'No user information, authorization denied' });
      }
      if (req.user.role !== 'admin') {
        return res.status(403).json({ msg: 'Admin access only' });
      }
      next();
    } catch (err) {
      console.error('Admin role check error:', err);
      res.status(500).json({ msg: 'Server error verifying admin role' });
    }
  }
  