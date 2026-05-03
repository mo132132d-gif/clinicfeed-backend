const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validate } = require('../middleware/validate');
const { createCrudController } = require('../controllers/crud.controller');

function createCrudRouter(config, validators) {
  const router = express.Router();
  const controller = createCrudController(config);

  router.use(authenticate);

  router.get('/', authorize(config.permissions.read), controller.list);
  router.get('/:id', authorize(config.permissions.read), controller.getById);
  router.post('/', authorize(config.permissions.write), validate(validators.create), controller.create);
  router.patch('/:id', authorize(config.permissions.write), validate(validators.update), controller.update);
  router.delete('/:id', authorize(config.permissions.write), controller.remove);

  return router;
}

module.exports = { createCrudRouter };
