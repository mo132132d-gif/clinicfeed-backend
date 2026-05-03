const crudRepository = require('../repositories/crud.repository');
const { withTransaction } = require('../db/transaction');
const { createHttpError } = require('../utils/httpError');
const { logActivity } = require('./activityLog.service');

function ensurePayload(config, data) {
  const allowedKeys = Object.keys(data).filter((key) => config.fields.includes(key) && data[key] !== undefined);
  if (allowedKeys.length === 0) {
    throw createHttpError(400, 'No valid fields were provided');
  }
}

function actorId(user) {
  return user ? user.id : null;
}

async function list(config, queryParams) {
  return crudRepository.list(config, queryParams);
}

async function getById(config, id) {
  const row = await crudRepository.findById(config, id);
  if (!row) {
    throw createHttpError(404, `${config.entityType} not found`);
  }

  return row;
}

async function create(config, data, user) {
  ensurePayload(config, data);

  if (!config.audit) {
    return crudRepository.create(config, data);
  }

  return withTransaction(async (client) => {
    const row = await crudRepository.create(config, data, client);
    await logActivity({
      client,
      userId: actorId(user),
      action: 'created',
      entityType: config.entityType,
      entityId: row.id,
      oldValue: null,
      newValue: row
    });

    return row;
  });
}

async function update(config, id, data, user) {
  ensurePayload(config, data);

  if (!config.audit) {
    const row = await crudRepository.update(config, id, data);
    if (!row) {
      throw createHttpError(404, `${config.entityType} not found`);
    }

    return row;
  }

  return withTransaction(async (client) => {
    const existing = await crudRepository.findById(config, id, client);
    if (!existing) {
      throw createHttpError(404, `${config.entityType} not found`);
    }

    const row = await crudRepository.update(config, id, data, client);
    await logActivity({
      client,
      userId: actorId(user),
      action: 'updated',
      entityType: config.entityType,
      entityId: row.id,
      oldValue: existing,
      newValue: row
    });

    return row;
  });
}

async function remove(config, id, user) {
  if (!config.audit) {
    const row = await crudRepository.remove(config, id);
    if (!row) {
      throw createHttpError(404, `${config.entityType} not found`);
    }

    return row;
  }

  return withTransaction(async (client) => {
    const existing = await crudRepository.findById(config, id, client);
    if (!existing) {
      throw createHttpError(404, `${config.entityType} not found`);
    }

    const row = await crudRepository.remove(config, id, client);
    await logActivity({
      client,
      userId: actorId(user),
      action: 'deleted',
      entityType: config.entityType,
      entityId: id,
      oldValue: existing,
      newValue: null
    });

    return row;
  });
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove
};
