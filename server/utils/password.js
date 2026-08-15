/** 密码哈希、校验及旧明文密码的兼容升级逻辑。 */
const crypto = require('crypto');

const HASH_ALGORITHM = 'scrypt';
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
};

function normalizePassword(password) {
  return typeof password === 'string' ? password : '';
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(
    normalizePassword(password),
    salt,
    KEY_LENGTH,
    SCRYPT_OPTIONS,
  );

  return [
    HASH_ALGORITHM,
    String(SCRYPT_OPTIONS.N),
    String(SCRYPT_OPTIONS.r),
    String(SCRYPT_OPTIONS.p),
    String(KEY_LENGTH),
    salt.toString('hex'),
    derivedKey.toString('hex'),
  ].join('$');
}

function isPasswordHash(value) {
  return typeof value === 'string' && value.startsWith(`${HASH_ALGORITHM}$`);
}

function verifyHashedPassword(password, storedPassword) {
  const parts = String(storedPassword || '').split('$');
  if (parts.length !== 7 || parts[0] !== HASH_ALGORITHM) {
    return false;
  }

  const [, n, r, p, keyLength, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(
    normalizePassword(password),
    Buffer.from(saltHex, 'hex'),
    Number(keyLength),
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    },
  );

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function verifyLegacyPassword(password, storedPassword) {
  const passwordBuffer = Buffer.from(normalizePassword(password));
  const storedBuffer = Buffer.from(String(storedPassword || ''));
  if (passwordBuffer.length !== storedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(passwordBuffer, storedBuffer);
}

function verifyPassword(password, storedPassword) {
  if (isPasswordHash(storedPassword)) {
    return verifyHashedPassword(password, storedPassword);
  }
  return verifyLegacyPassword(password, storedPassword);
}

function shouldUpgradePasswordHash(storedPassword) {
  return Boolean(storedPassword) && !isPasswordHash(storedPassword);
}

function validatePasswordPolicy(password) {
  const normalized = normalizePassword(password);
  if (normalized.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[A-Za-z]/.test(normalized) || !/\d/.test(normalized)) {
    return 'Password must contain both letters and numbers';
  }
  return null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  shouldUpgradePasswordHash,
  validatePasswordPolicy,
};
