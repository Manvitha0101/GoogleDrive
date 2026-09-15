'use strict';

const { verifyAccessToken } = require('../lib/jwt');
const prisma = require('../lib/prisma');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthenticated',
        message: 'Missing or invalid Authorization header. Expected Bearer <token>.',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({
        error: 'token_invalid_or_expired',
        message: 'Your access token has expired or is invalid.',
      });
    }

    // Attach decoded user
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(500).json({
      error: 'auth_middleware_error',
      message: err.message,
    });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);
      if (decoded) {
        req.user = decoded;
      }
    }
    next();
  } catch (err) {
    next();
  }
}

module.exports = {
  requireAuth,
  optionalAuth,
};
