const express = require('express');
const router = express.Router();
const { login, updateUserStatus } = require('../controllers/adminController');

router.post('/login', login);
router.patch('/users/:userid/status', updateUserStatus);

module.exports = router;