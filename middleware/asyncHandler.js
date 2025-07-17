/**
 * Wraps async route handlers and passes errors to Express error handler.
 *
 * Usage:
 *   router.get('/', asyncHandler(async (req, res) => {
 *     // your async code
 *   }));
 */
export default function asyncHandler(fn) {
    return function (req, res, next) {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
  