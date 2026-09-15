'use strict';

const { generateTokens, verifyAccessToken, verifyRefreshToken } = require('../src/lib/jwt');

describe('Authentication & JWT Utility Tests', () => {
  const mockUser = {
    id: 'test-uuid-1234',
    email: 'test@cloudvault.internal',
    displayName: 'Test User',
  };

  test('generateTokens generates valid access and refresh tokens', () => {
    const tokens = generateTokens(mockUser);
    expect(tokens).toHaveProperty('accessToken');
    expect(tokens).toHaveProperty('refreshToken');
    expect(tokens).toHaveProperty('expiresIn');
    expect(typeof tokens.accessToken).toBe('string');
  });

  test('verifyAccessToken successfully verifies generated access token', () => {
    const tokens = generateTokens(mockUser);
    const decoded = verifyAccessToken(tokens.accessToken);
    expect(decoded).not.toBeNull();
    expect(decoded.id).toBe(mockUser.id);
    expect(decoded.email).toBe(mockUser.email);
    expect(decoded.displayName).toBe(mockUser.displayName);
  });

  test('verifyAccessToken rejects invalid or corrupted token', () => {
    const decoded = verifyAccessToken('invalid.token.payload');
    expect(decoded).toBeNull();
  });

  test('verifyRefreshToken successfully verifies refresh token', () => {
    const tokens = generateTokens(mockUser);
    const decoded = verifyRefreshToken(tokens.refreshToken);
    expect(decoded).not.toBeNull();
    expect(decoded.id).toBe(mockUser.id);
  });
});
