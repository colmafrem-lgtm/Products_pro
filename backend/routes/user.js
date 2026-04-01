const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const { getProfile, getDashboard, getTransactions, requestDeposit, requestWithdrawal, updateProfile, getSpinInfo, doSpin } = require('../controllers/userController');

router.get('/profile', authenticateUser, getProfile);
router.put('/profile', authenticateUser, updateProfile);
router.get('/dashboard', authenticateUser, getDashboard);
router.get('/transactions', authenticateUser, getTransactions);
router.post('/deposit', authenticateUser, requestDeposit);
router.post('/withdraw', authenticateUser, requestWithdrawal);
router.get('/spin-info', authenticateUser, getSpinInfo);
router.post('/spin', authenticateUser, doSpin);

module.exports = router;
