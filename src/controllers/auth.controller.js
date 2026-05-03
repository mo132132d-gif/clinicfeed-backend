const authService = require('../services/auth.service');
const { asyncHandler } = require('../utils/asyncHandler');

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  res.json({ data });
});

const me = asyncHandler(async (req, res) => {
  res.json({ data: req.user });
});

const listUsers = asyncHandler(async (req, res) => {
  const result = await authService.listUsers(req.query);
  res.json(result);
});

const getUserById = asyncHandler(async (req, res) => {
  const data = await authService.getUserById(req.params.id);
  res.json({ data });
});

const createUser = asyncHandler(async (req, res) => {
  const data = await authService.createUser(req.body, req.user);
  res.status(201).json({ data });
});

const updateUser = asyncHandler(async (req, res) => {
  const data = await authService.updateUser(req.params.id, req.body, req.user);
  res.json({ data });
});

const deleteUser = asyncHandler(async (req, res) => {
  const data = await authService.deleteUser(req.params.id, req.user);
  res.json({ data });
});

module.exports = {
  login,
  me,
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
};
