const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');
const { getProfile, getDashboard, getTransactions, requestDeposit, requestWithdrawal, updateProfile, getSpinInfo, doSpin, signinBonus } = require('../controllers/userController');
const { addClient, removeClient } = require('../utils/sse');

router.get('/profile', authenticateUser, getProfile);
router.put('/profile', authenticateUser, updateProfile);
router.get('/dashboard', authenticateUser, getDashboard);
router.get('/transactions', authenticateUser, getTransactions);
router.post('/deposit', authenticateUser, requestDeposit);
router.post('/withdraw', authenticateUser, requestWithdrawal);
router.get('/spin-info', authenticateUser, getSpinInfo);
router.post('/spin', authenticateUser, doSpin);
router.post('/signin-bonus', authenticateUser, signinBonus);

// GET /api/user/events — SSE endpoint for real-time updates
router.get('/events', authenticateUser, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Required for Railway/nginx proxies
    res.flushHeaders();

    const userId = req.user.id;
    addClient(userId, res);

    // Send initial connection confirmation
    res.write('event: connected\ndata: {"status":"ok"}\n\n');

    req.on('close', () => {
        removeClient(userId, res);
    });
});

module.exports = router;
