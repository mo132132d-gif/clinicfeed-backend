const { pool } = require('../db/pool');

function runner(client) {
  return client || pool;
}

async function logActivity({ client, userId, action, entityType, entityId, oldValue, newValue }) {
  const db = runner(client);

  await db.query(
    `
      INSERT INTO activity_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_value,
        new_value
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      userId || null,
      action,
      entityType,
      entityId || null,
      oldValue || null,
      newValue || null
    ]
  );
}

module.exports = { logActivity };
