const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const { getAvailableTask, submitTask, getTaskHistory, getProducts } = require('../controllers/taskController');

router.get('/available', authenticateUser, getAvailableTask);
router.post('/:id/submit', authenticateUser, submitTask);
router.get('/history', authenticateUser, getTaskHistory);
router.get('/products', getProducts); // public - used on welcome page

module.exports = router;
