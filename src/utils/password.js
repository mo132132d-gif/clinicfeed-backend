const bcrypt = require('bcryptjs');
const { env } = require('../config/env');

function hashPassword(password) {
  return bcrypt.hash(password, env.bcryptRounds);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  hashPassword,
  verifyPassword
};
