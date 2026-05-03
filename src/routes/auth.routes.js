const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validate } = require('../middleware/validate');
const { createUserSchema, loginSchema, updateUserSchema } = require('../validators/entity.validators');

const router = express.Router();

router.post('/login', validate(loginSchema), authController.login);

router.use(authenticate);

router.get('/me', authController.me);
router.get('/users', authorize('users:manage'), authController.listUsers);
router.post('/users', authorize('users:manage'), validate(createUserSchema), authController.createUser);
router.get('/users/:id', authorize('users:manage'), authController.getUserById);
router.patch('/users/:id', authorize('users:manage'), validate(updateUserSchema), authController.updateUser);
router.delete('/users/:id', authorize('users:manage'), authController.deleteUser);

module.exports = { authRouter: router };
