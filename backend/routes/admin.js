const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { authenticateAdmin, requireSuperAdmin } = require('../middleware/auth');
const { addAdminClient, removeAdminClient } = require('../utils/sse');
const {
    adminLogin, getDashboard, getUsers, updateUserStatus, adjustBalance, setWithdrawalPassword,
    getDeposits, approveDeposit, getWithdrawals, processWithdrawal,
    getProducts, createProduct, updateProduct, deleteProduct,
    getSettings, updateSettings,
    getVipLevels, updateVipLevel, addVipLevel, deleteVipLevel,
    updateUserProfile, searchUsers, resetTaskVolume, toggleTransactionStatus, toggleTestStatus, getUserTeam, getUserTasks, addUserTask, updateUserTask, syncTasksByProduct, deleteUserTask,
    createUser, deleteUsers,
    getPrizeRecords, reviewPrizeRecord, deletePrizeRecord,
    getSpinPrizes, createSpinPrize, updateSpinPrize, deleteSpinPrize,
    getPointsRecords
} = require('../controllers/adminController');

const storage = multer.diskStorage({
    destination: path.join(__dirname, '../uploads'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, 'product_' + Date.now() + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files allowed'));
    }
});

// Public
router.post('/login', adminLogin);

// Admin SSE — real-time events for admin panel
router.get('/events', authenticateAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('event: connected\ndata: {}\n\n');
    addAdminClient(res);
    req.on('close', () => removeAdminClient(res));
});

// Protected - all routes below require admin auth
router.use(authenticateAdmin);

// Dashboard
router.get('/dashboard', getDashboard);

// Users
router.get('/users', getUsers);
router.get('/users/search', searchUsers);
router.put('/users/:id/status', updateUserStatus);
router.put('/users/:id/balance', requireSuperAdmin, adjustBalance);
router.put('/users/:id/withdrawal-password', requireSuperAdmin, setWithdrawalPassword);
router.put('/users/:id/profile', requireSuperAdmin, updateUserProfile);
router.put('/users/:id/reset-tasks', requireSuperAdmin, resetTaskVolume);
router.put('/users/:id/reset-password', authenticateAdmin, async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    try {
        const bcrypt = require('bcryptjs');
        const hashed = await bcrypt.hash(password, 10);
        const db = require('../config/db');
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.params.id]);
        res.json({ success: true, message: 'Password reset successfully.' });
    } catch(e) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});
router.put('/users/:id/transaction-status', requireSuperAdmin, toggleTransactionStatus);
router.put('/users/:id/test-status', requireSuperAdmin, toggleTestStatus);
router.get('/users/:id/team', getUserTeam);
router.get('/users/:id/tasks', getUserTasks);
router.put('/users/:id/tasks/sync-product/:productId', requireSuperAdmin, syncTasksByProduct);
router.put('/users/:id/tasks/:taskId', requireSuperAdmin, updateUserTask);
router.delete('/users/:id/tasks/:taskId', requireSuperAdmin, deleteUserTask);
router.post('/tasks', requireSuperAdmin, addUserTask);
router.post('/users', requireSuperAdmin, createUser);
router.delete('/users', requireSuperAdmin, deleteUsers);

// Deposits
router.get('/deposits', getDeposits);
router.put('/deposits/:id/process', approveDeposit);

// Withdrawals
router.get('/withdrawals', getWithdrawals);
router.put('/withdrawals/:id/process', processWithdrawal);

// Image upload
router.post('/upload', authenticateAdmin, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
});

// Products
router.get('/products', getProducts);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', requireSuperAdmin, deleteProduct);

// VIP Levels
router.get('/vip-levels', getVipLevels);
router.post('/vip-levels', requireSuperAdmin, addVipLevel);
router.put('/vip-levels/:id', requireSuperAdmin, updateVipLevel);
router.delete('/vip-levels/:id', requireSuperAdmin, deleteVipLevel);

// Prize Records
router.get('/prize-records', getPrizeRecords);
router.put('/prize-records/:id/review', requireSuperAdmin, reviewPrizeRecord);
router.delete('/prize-records/:id', requireSuperAdmin, deletePrizeRecord);

// Spin Prizes
router.get('/spin-prizes', getSpinPrizes);
router.post('/spin-prizes', requireSuperAdmin, createSpinPrize);
router.put('/spin-prizes/:id', requireSuperAdmin, updateSpinPrize);
router.delete('/spin-prizes/:id', requireSuperAdmin, deleteSpinPrize);

// Points Records
router.get('/points-records', getPointsRecords);

// Settings
router.get('/settings', requireSuperAdmin, getSettings);
router.put('/settings', requireSuperAdmin, updateSettings);

module.exports = router;
