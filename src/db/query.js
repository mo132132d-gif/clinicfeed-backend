const { pool } = require('./pool');

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { query };
