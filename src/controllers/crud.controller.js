const crudService = require('../services/crud.service');
const { asyncHandler } = require('../utils/asyncHandler');

function createCrudController(config) {
  return {
    list: asyncHandler(async (req, res) => {
      const result = await crudService.list(config, req.query);
      res.json(result);
    }),

    getById: asyncHandler(async (req, res) => {
      const data = await crudService.getById(config, req.params.id);
      res.json({ data });
    }),

    create: asyncHandler(async (req, res) => {
      const data = await crudService.create(config, req.body, req.user);
      res.status(201).json({ data });
    }),

    update: asyncHandler(async (req, res) => {
      const data = await crudService.update(config, req.params.id, req.body, req.user);
      res.json({ data });
    }),

    remove: asyncHandler(async (req, res) => {
      const data = await crudService.remove(config, req.params.id, req.user);
      res.json({ data });
    })
  };
}

module.exports = { createCrudController };
