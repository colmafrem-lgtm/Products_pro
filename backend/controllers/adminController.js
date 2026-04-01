const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// POST /api/admin/login
const adminLogin = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password required.' });
    }

    try {
        const [admins] = await db.query(
            'SELECT * FROM admins WHERE username = ? AND status = "active"',
            [username]
        );

        if (admins.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const admin = admins[0];
        const isMatch = await bcrypt.compare(password, admin.password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const token = jwt.sign(
            { id: admin.id, username: admin.username, role: admin.role },
            process.env.ADMIN_JWT_SECRET,
            { expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '1d' }
        );

        res.json({
            success: true,
            message: 'Admin login successful.',
            data: {
                token,
                admin: { id: admin.id, username: admin.username, email: admin.email, role: admin.role }
            }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/dashboard  — stats overview
const getDashboard = async (req, res) => {
    try {
        const [totalUsers] = await db.query('SELECT COUNT(*) as count FROM users');
        const [activeUsers] = await db.query('SELECT COUNT(*) as count FROM users WHERE status = "active"');
        const [totalDeposited] = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE status = "approved"');
        const [totalWithdrawn] = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = "approved"');
        const [totalCommissions] = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = "commission"');
        const [totalTasks] = await db.query('SELECT COUNT(*) as count FROM tasks WHERE status = "completed"');
        const [pendingDeposits] = await db.query('SELECT COUNT(*) as count FROM deposits WHERE status = "pending"');
        const [pendingWithdrawals] = await db.query('SELECT COUNT(*) as count FROM withdrawals WHERE status = "pending"');

        // Recent registrations (last 7 days)
        const [recentUsers] = await db.query(
            `SELECT DATE(created_at) as date, COUNT(*) as count
             FROM users WHERE created_at >= datetime('now', '-7 days')
             GROUP BY DATE(created_at) ORDER BY date ASC`
        );

        // VIP distribution
        const [vipDistribution] = await db.query(
            `SELECT u.vip_level, v.name, COUNT(*) as count
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             GROUP BY u.vip_level, v.name ORDER BY u.vip_level`
        );

        res.json({
            success: true,
            data: {
                stats: {
                    total_users: totalUsers[0].count,
                    active_users: activeUsers[0].count,
                    total_deposited: parseFloat(totalDeposited[0].total),
                    total_withdrawn: parseFloat(totalWithdrawn[0].total),
                    total_commissions: parseFloat(totalCommissions[0].total),
                    total_tasks: totalTasks[0].count,
                    pending_deposits: pendingDeposits[0].count,
                    pending_withdrawals: pendingWithdrawals[0].count
                },
                recent_users: recentUsers,
                vip_distribution: vipDistribution
            }
        });

    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/users
const getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';

        let query = `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.balance,
                            u.total_earned, u.vip_level, u.status, u.referral_code, u.invitation_code, u.created_at,
                            u.withdrawal_password, u.withdrawal_times, u.referred_by, u.transaction_disabled, u.is_test,
                            v.name as vip_name
                     FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
                     WHERE 1=1`;
        let params = [];

        if (search) {
            query += ' AND (u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status) {
            query += ' AND u.status = ?';
            params.push(status);
        }

        query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [users] = await db.query(query, params);

        // Enrich each user with extra stats
        for (const u of users) {
            const [refs]  = await db.query('SELECT COUNT(*) as c FROM users WHERE referred_by = ?', [u.id]);
            const [deps]  = await db.query("SELECT COALESCE(SUM(amount),0) as c FROM deposits WHERE user_id = ? AND status = 'approved'", [u.id]);
            const [wds]   = await db.query("SELECT COALESCE(SUM(amount),0) as c FROM withdrawals WHERE user_id = ? AND (status = 'approved' OR status = 'completed')", [u.id]);
            const [ttask] = await db.query("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND status = 'completed' AND DATE(completed_at) = DATE('now')", [u.id]);
            const [atask] = await db.query("SELECT COUNT(*) as c FROM tasks WHERE user_id = ? AND status = 'completed'", [u.id]);
            u.total_referrals  = refs[0]?.c  || 0;
            u.total_deposits   = deps[0]?.c  || 0;
            u.total_withdrawals= wds[0]?.c   || 0;
            u.today_tasks      = ttask[0]?.c || 0;
            u.total_tasks      = atask[0]?.c || 0;
        }

        const [countRows] = await db.query(
            `SELECT COUNT(*) as total FROM users WHERE 1=1
             ${search ? 'AND (username LIKE ? OR email LIKE ? OR full_name LIKE ?)' : ''}
             ${status ? 'AND status = ?' : ''}`,
            search ? [`%${search}%`, `%${search}%`, `%${search}%`, ...(status ? [status] : [])] : (status ? [status] : [])
        );

        res.json({
            success: true,
            data: {
                users,
                pagination: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) }
            }
        });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/users/:id/status  — activate/suspend user
const updateUserStatus = async (req, res) => {
    const { status } = req.body;
    const userId = req.params.id;

    if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    try {
        await db.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
        res.json({ success: true, message: `User ${status} successfully.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/users/:id/balance  — manually adjust balance
const adjustBalance = async (req, res) => {
    const { amount, type, description } = req.body;
    const userId = req.params.id;

    if (!amount || !type || !['add', 'deduct'].includes(type)) {
        return res.status(400).json({ success: false, message: 'Amount and type (add/deduct) required.' });
    }

    try {
        const [users] = await db.query('SELECT balance FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });

        const currentBalance = parseFloat(users[0].balance);
        const adjustAmount = parseFloat(amount);
        let newBalance = type === 'add' ? currentBalance + adjustAmount : currentBalance - adjustAmount;

        if (newBalance < 0) {
            return res.status(400).json({ success: false, message: 'Cannot deduct more than current balance.' });
        }

        await db.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

        await db.query(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, status)
             VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
            [userId, type === 'add' ? 'deposit' : 'withdrawal', adjustAmount, currentBalance, newBalance,
             description || `Admin ${type === 'add' ? 'added' : 'deducted'} balance`]
        );

        res.json({ success: true, message: `Balance ${type === 'add' ? 'added' : 'deducted'} successfully.`, data: { new_balance: newBalance } });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/deposits
const getDeposits = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || 'pending';

        const [deposits] = await db.query(
            `SELECT d.*, u.username, u.email FROM deposits d
             JOIN users u ON d.user_id = u.id
             WHERE d.status = ? ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
            [status, limit, offset]
        );

        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM deposits WHERE status = ?',
            [status]
        );

        res.json({ success: true, data: { deposits, pagination: { page, limit, total: countResult[0].total, pages: Math.ceil(countResult[0].total / limit) } } });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/deposits/:id/approve  — approve deposit
const approveDeposit = async (req, res) => {
    const depositId = req.params.id;
    const { action, admin_note } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Action must be approve or reject.' });
    }

    try {
        const [deposits] = await db.query(
            'SELECT * FROM deposits WHERE id = ? AND status = "pending"',
            [depositId]
        );

        if (deposits.length === 0) {
            return res.status(404).json({ success: false, message: 'Deposit not found or already processed.' });
        }

        const deposit = deposits[0];
        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        await db.query(
            'UPDATE deposits SET status = ?, admin_note = ?, processed_at = NOW() WHERE id = ?',
            [newStatus, admin_note || '', depositId]
        );

        if (action === 'approve') {
            const [users] = await db.query('SELECT balance FROM users WHERE id = ?', [deposit.user_id]);
            const currentBalance = parseFloat(users[0].balance);
            const newBalance = currentBalance + parseFloat(deposit.amount);

            await db.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, deposit.user_id]);

            // Check VIP upgrade based on total deposits
            const [totalDeposit] = await db.query(
                'SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = ? AND status = "approved"',
                [deposit.user_id]
            );

            const [vipLevels] = await db.query('SELECT * FROM vip_levels ORDER BY level DESC');
            for (const vip of vipLevels) {
                if (parseFloat(totalDeposit[0].total) >= vip.min_deposit) {
                    await db.query('UPDATE users SET vip_level = ? WHERE id = ?', [vip.level, deposit.user_id]);
                    break;
                }
            }

            await db.query(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, reference_id, status)
                 VALUES (?, 'deposit', ?, ?, ?, ?, ?, 'completed')`,
                [deposit.user_id, deposit.amount, currentBalance, newBalance, `Deposit approved #${depositId}`, depositId]
            );
        }

        res.json({ success: true, message: `Deposit ${action}d successfully.` });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/withdrawals
const getWithdrawals = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || 'pending';

        const [withdrawals] = await db.query(
            `SELECT w.*, u.username, u.email FROM withdrawals w
             JOIN users u ON w.user_id = u.id
             WHERE w.status = ? ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
            [status, limit, offset]
        );

        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM withdrawals WHERE status = ?',
            [status]
        );

        res.json({ success: true, data: { withdrawals, pagination: { page, limit, total: countResult[0].total, pages: Math.ceil(countResult[0].total / limit) } } });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/withdrawals/:id/process
const processWithdrawal = async (req, res) => {
    const withdrawalId = req.params.id;
    const { action, admin_note } = req.body;

    if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Action must be approve or reject.' });
    }

    try {
        const [withdrawals] = await db.query(
            'SELECT * FROM withdrawals WHERE id = ? AND status = "pending"',
            [withdrawalId]
        );

        if (withdrawals.length === 0) {
            return res.status(404).json({ success: false, message: 'Withdrawal not found or already processed.' });
        }

        const withdrawal = withdrawals[0];
        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        await db.query(
            'UPDATE withdrawals SET status = ?, admin_note = ?, processed_at = NOW() WHERE id = ?',
            [newStatus, admin_note || '', withdrawalId]
        );

        if (action === 'reject') {
            // Refund balance back to user
            await db.query(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [withdrawal.amount, withdrawal.user_id]
            );

            const [users] = await db.query('SELECT balance FROM users WHERE id = ?', [withdrawal.user_id]);
            await db.query(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, reference_id, status)
                 VALUES (?, 'refund', ?, ?, ?, ?, ?, 'completed')`,
                [withdrawal.user_id, withdrawal.amount,
                 users[0].balance - withdrawal.amount, users[0].balance,
                 `Withdrawal rejected - refunded #${withdrawalId}`, withdrawalId]
            );
        } else {
            await db.query(
                `UPDATE transactions SET status = 'completed' WHERE reference_id = ? AND type = 'withdrawal'`,
                [withdrawalId]
            );
        }

        res.json({ success: true, message: `Withdrawal ${action}d successfully.` });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/products
const getProducts = async (req, res) => {
    try {
        const [products] = await db.query('SELECT * FROM products ORDER BY created_at DESC');
        res.json({ success: true, data: products });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/admin/products
const createProduct = async (req, res) => {
    const { name, description, price, image_url, category, commission_rate } = req.body;

    if (!name || !price) {
        return res.status(400).json({ success: false, message: 'Name and price are required.' });
    }

    try {
        const [result] = await db.query(
            `INSERT INTO products (name, description, price, image_url, category, commission_rate)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [name, description || '', price, image_url || '', category || 'General', commission_rate || 1.00]
        );

        res.status(201).json({ success: true, message: 'Product created.', data: { id: result.insertId } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/products/:id
const updateProduct = async (req, res) => {
    const { name, description, price, image_url, category, commission_rate, status } = req.body;

    try {
        await db.query(
            `UPDATE products SET name=?, description=?, price=?, image_url=?, category=?, commission_rate=?, status=?
             WHERE id = ?`,
            [name, description, price, image_url, category, commission_rate, status, req.params.id]
        );
        res.json({ success: true, message: 'Product updated.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// DELETE /api/admin/products/:id
const deleteProduct = async (req, res) => {
    try {
        await db.query('UPDATE products SET status = "inactive" WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Product deactivated.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/settings
const getSettings = async (req, res) => {
    try {
        const [settings] = await db.query('SELECT * FROM settings ORDER BY setting_key');
        res.json({ success: true, data: settings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/settings
const updateSettings = async (req, res) => {
    const { settings } = req.body; // Array of { key, value }

    if (!Array.isArray(settings)) {
        return res.status(400).json({ success: false, message: 'Settings must be an array.' });
    }

    try {
        for (const setting of settings) {
            await db.query(
                `INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, '')
                 ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
                [setting.key, setting.value]
            );
        }
        res.json({ success: true, message: 'Settings updated.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/users/:id/withdrawal-password
const setWithdrawalPassword = async (req, res) => {
    const { password, withdrawal_times, limit_message } = req.body;
    const userId = req.params.id;

    const updates = [];
    const params = [];

    if (password !== undefined && password !== '') {
        if (!password || password.trim().length < 5)
            return res.status(400).json({ success: false, message: 'Withdrawal password must be at least 5 digits.' });
        if (!/^\d+$/.test(password.trim()))
            return res.status(400).json({ success: false, message: 'Withdrawal password must be digits only.' });
        updates.push('withdrawal_password = ?');
        params.push(password.trim());
    }

    if (withdrawal_times !== undefined && withdrawal_times !== '') {
        const t = parseInt(withdrawal_times);
        if (isNaN(t) || t < 0)
            return res.status(400).json({ success: false, message: 'Withdrawal times must be a valid number.' });
        updates.push('withdrawal_times = ?');
        params.push(t);
    }

    if (updates.length === 0 && !limit_message)
        return res.status(400).json({ success: false, message: 'Nothing to update.' });

    try {
        if (updates.length > 0) {
            params.push(userId);
            await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        if (limit_message !== undefined && limit_message.trim() !== '') {
            await db.query(
                `INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?)
                 ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
                ['withdrawal_limit_message', limit_message.trim(), 'Alert shown when withdrawal limit reached']
            );
        }
        res.json({ success: true, message: 'Updated successfully.' });
    } catch (error) {
        console.error('Set withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/users/:id/tasks — get user's tasks/orders
const getUserTasks = async (req, res) => {
    const userId = req.params.id;
    try {
        const [tasks] = await db.query(
            `SELECT t.id, t.product_id, t.task_number, t.product_price, t.commission_amount,
                    t.status, t.created_at, t.completed_at,
                    p.name as product_name, p.commission_rate
             FROM tasks t
             LEFT JOIN products p ON t.product_id = p.id
             WHERE t.user_id = ?
             ORDER BY t.created_at DESC`,
            [userId]
        );
        res.json({ success: true, data: tasks });
    } catch (error) {
        console.error('Get user tasks error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/admin/tasks — manually add a task for a user
const addUserTask = async (req, res) => {
    const { user_id, product_id, task_number, product_price, commission_amount } = req.body;
    if (!user_id || !product_id) {
        return res.status(400).json({ success: false, message: 'user_id and product_id are required.' });
    }
    try {
        await db.query(
            `INSERT INTO tasks (user_id, product_id, task_number, product_price, commission_amount, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [user_id, product_id, task_number || 1, parseFloat(product_price) || 0, parseFloat(commission_amount) || 0]
        );
        res.status(201).json({ success: true, message: 'Task added.' });
    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// DELETE /api/admin/users/:id/tasks/:taskId — delete a specific task
const deleteUserTask = async (req, res) => {
    const { id: userId, taskId } = req.params;
    try {
        const [rows] = await db.query('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Task not found.' });
        await db.query('DELETE FROM tasks WHERE id = ?', [taskId]);
        res.json({ success: true, message: 'Task deleted.' });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/users/:id/profile — edit basic info + referred_by
const updateUserProfile = async (req, res) => {
    const userId = req.params.id;
    const { full_name, phone, email, vip_level, referred_by, credit_score } = req.body;
    try {
        // Validate referred_by if provided
        let referredById = null;
        if (referred_by && String(referred_by).trim() !== '') {
            // Accept username or ID
            const val = String(referred_by).trim();
            const [rows] = await db.query(
                'SELECT id FROM users WHERE id = ? OR username = ? LIMIT 1',
                [parseInt(val) || 0, val]
            );
            if (!rows.length) return res.status(400).json({ success: false, message: `Referrer "${val}" not found.` });
            if (String(rows[0].id) === String(userId)) return res.status(400).json({ success: false, message: 'User cannot refer themselves.' });
            referredById = rows[0].id;
        }

        const cs = Math.min(100, Math.max(0, parseInt(credit_score) || 80));
        if (referredById !== null) {
            await db.query(
                'UPDATE users SET full_name=?, phone=?, email=?, vip_level=?, referred_by=?, credit_score=? WHERE id=?',
                [full_name || '', phone || '', email || '', parseInt(vip_level) || 1, referredById, cs, userId]
            );
        } else {
            await db.query(
                'UPDATE users SET full_name=?, phone=?, email=?, vip_level=?, credit_score=? WHERE id=?',
                [full_name || '', phone || '', email || '', parseInt(vip_level) || 1, cs, userId]
            );
        }
        res.json({ success: true, message: 'User profile updated.' });
    } catch (error) {
        console.error('Update user profile error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/users/search?q= — quick user search for referrer picker
const searchUsers = async (req, res) => {
    const q = req.query.q || '';
    try {
        const [rows] = await db.query(
            `SELECT id, username, referral_code FROM users WHERE username LIKE ? OR id = ? LIMIT 10`,
            ['%' + q + '%', parseInt(q) || 0]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/users/:id/test-status — toggle is_test user
const toggleTestStatus = async (req, res) => {
    const userId = req.params.id;
    const { is_test } = req.body;
    try {
        await db.query('UPDATE users SET is_test = ? WHERE id = ?', [is_test ? 1 : 0, userId]);
        res.json({ success: true, message: is_test ? 'User set as test user.' : 'User removed from test.' });
    } catch (error) {
        console.error('Toggle test status error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/users/:id/transaction-status — toggle transaction disabled
const toggleTransactionStatus = async (req, res) => {
    const userId = req.params.id;
    const { disabled } = req.body;
    try {
        await db.query(
            'UPDATE users SET transaction_disabled = ? WHERE id = ?',
            [disabled ? 1 : 0, userId]
        );
        res.json({ success: true, message: disabled ? 'Transactions disabled.' : 'Transactions enabled.' });
    } catch (error) {
        console.error('Toggle transaction status error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/users/:id/reset-tasks — reset today's task count
const resetTaskVolume = async (req, res) => {
    const userId = req.params.id;
    try {
        await db.query(
            `DELETE FROM tasks WHERE user_id = ? AND DATE(created_at) = DATE('now')`,
            [userId]
        );
        res.json({ success: true, message: 'Task volume reset successfully.' });
    } catch (error) {
        console.error('Reset task volume error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/users/:id/team — get referral team
const getUserTeam = async (req, res) => {
    const userId = req.params.id;
    try {
        const [members] = await db.query(
            `SELECT u.id, u.username, u.email, u.vip_level, u.balance, u.status, u.created_at,
                    v.name as vip_name
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.referred_by = ? ORDER BY u.created_at DESC`,
            [userId]
        );
        res.json({ success: true, data: members });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/vip-levels
const getVipLevels = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM vip_levels ORDER BY level ASC');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Get VIP levels error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/vip-levels/:id
const updateVipLevel = async (req, res) => {
    const { id } = req.params;
    const {
        name, min_deposit, commission_rate, daily_task_limit, description, color,
        task_wheel, upgrade_rewards, price_per_grade, min_withdrawal, max_withdrawal, transaction_fee_rate
    } = req.body;

    if (!name || min_deposit === undefined || commission_rate === undefined || !daily_task_limit) {
        return res.status(400).json({ success: false, message: 'Name, min deposit, commission rate, and daily task limit are required.' });
    }

    try {
        await db.query(
            `UPDATE vip_levels SET
                name=?, min_deposit=?, commission_rate=?, daily_task_limit=?, description=?, color=?,
                task_wheel=?, upgrade_rewards=?, price_per_grade=?, min_withdrawal=?, max_withdrawal=?, transaction_fee_rate=?
             WHERE id=?`,
            [
                name, parseFloat(min_deposit), parseFloat(commission_rate), parseInt(daily_task_limit),
                description || '', color || '#8B5CF6',
                parseInt(task_wheel) || 1, parseFloat(upgrade_rewards) || 0,
                parseFloat(price_per_grade) || 0, parseFloat(min_withdrawal) || 10,
                parseFloat(max_withdrawal) || 1000, parseFloat(transaction_fee_rate) || 0,
                id
            ]
        );
        res.json({ success: true, message: 'VIP level updated successfully.' });
    } catch (error) {
        console.error('Update VIP level error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/admin/vip-levels
const addVipLevel = async (req, res) => {
    const {
        name, min_deposit, commission_rate, daily_task_limit, description, color,
        task_wheel, upgrade_rewards, price_per_grade, min_withdrawal, max_withdrawal, transaction_fee_rate
    } = req.body;

    if (!name || min_deposit === undefined || commission_rate === undefined || !daily_task_limit) {
        return res.status(400).json({ success: false, message: 'Name, min deposit, commission rate, and daily task limit are required.' });
    }

    try {
        // Determine next level number
        const [rows] = await db.query('SELECT MAX(level) as maxLevel FROM vip_levels');
        const nextLevel = (rows[0].maxLevel || 0) + 1;

        const [result] = await db.query(
            `INSERT INTO vip_levels (level, name, min_deposit, commission_rate, daily_task_limit, description, color,
                task_wheel, upgrade_rewards, price_per_grade, min_withdrawal, max_withdrawal, transaction_fee_rate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nextLevel, name, parseFloat(min_deposit), parseFloat(commission_rate), parseInt(daily_task_limit),
                description || '', color || '#8B5CF6',
                parseInt(task_wheel) || 1, parseFloat(upgrade_rewards) || 0,
                parseFloat(price_per_grade) || 0, parseFloat(min_withdrawal) || 10,
                parseFloat(max_withdrawal) || 1000, parseFloat(transaction_fee_rate) || 0
            ]
        );
        res.status(201).json({ success: true, message: 'VIP level created successfully.', data: { id: result.insertId, level: nextLevel } });
    } catch (error) {
        console.error('Add VIP level error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// DELETE /api/admin/vip-levels/:id
const deleteVipLevel = async (req, res) => {
    const { id } = req.params;
    try {
        // Prevent deleting if users are assigned to this level
        const [levelRows] = await db.query('SELECT level FROM vip_levels WHERE id = ?', [id]);
        if (levelRows.length === 0) {
            return res.status(404).json({ success: false, message: 'VIP level not found.' });
        }
        const level = levelRows[0].level;
        const [userCount] = await db.query('SELECT COUNT(*) as cnt FROM users WHERE vip_level = ?', [level]);
        if (userCount[0].cnt > 0) {
            return res.status(400).json({ success: false, message: `Cannot delete: ${userCount[0].cnt} user(s) are on this level. Reassign them first.` });
        }
        await db.query('DELETE FROM vip_levels WHERE id = ?', [id]);
        res.json({ success: true, message: 'VIP level deleted successfully.' });
    } catch (error) {
        console.error('Delete VIP level error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/prize-records
const getPrizeRecords = async (req, res) => {
    try {
        const page   = parseInt(req.query.page)  || 1;
        const limit  = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || '';

        let query  = `SELECT p.*, u.username FROM prize_records p LEFT JOIN users u ON p.user_id = u.id WHERE 1=1`;
        let params = [];
        if (status) { query += ' AND p.status = ?'; params.push(status); }
        query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [records] = await db.query(query, params);
        const [countRows] = await db.query(
            `SELECT COUNT(*) as total FROM prize_records WHERE 1=1 ${status ? 'AND status = ?' : ''}`,
            status ? [status] : []
        );
        res.json({ success: true, data: { records, pagination: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } } });
    } catch (error) {
        console.error('Get prize records error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/prize-records/:id/review — approve prize, credit balance
const reviewPrizeRecord = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query('SELECT * FROM prize_records WHERE id = ?', [id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Record not found.' });
        const prize = rows[0];
        if (prize.status === 'reviewed') return res.status(400).json({ success: false, message: 'Already reviewed.' });

        // Credit amount to user balance
        if (prize.amount > 0) {
            const [userRows] = await db.query('SELECT balance FROM users WHERE id = ?', [prize.user_id]);
            if (userRows.length) {
                const newBalance = parseFloat(userRows[0].balance) + parseFloat(prize.amount);
                await db.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, prize.user_id]);
                await db.query(
                    `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, status)
                     VALUES (?, 'prize', ?, ?, ?, ?, 'completed')`,
                    [prize.user_id, prize.amount, userRows[0].balance, newBalance, `Prize: ${prize.prize_name}`]
                );
            }
        }
        await db.query(`UPDATE prize_records SET status = 'reviewed', reviewed_at = datetime('now') WHERE id = ?`, [id]);
        res.json({ success: true, message: 'Prize approved and balance credited.' });
    } catch (error) {
        console.error('Review prize error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// DELETE /api/admin/prize-records/:id
const deletePrizeRecord = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM prize_records WHERE id = ?', [id]);
        res.json({ success: true, message: 'Prize record deleted.' });
    } catch (error) {
        console.error('Delete prize record error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/spin-prizes
const getSpinPrizes = async (req, res) => {
    try {
        const [prizes] = await db.query(`SELECT * FROM spin_prizes ORDER BY weight DESC`);
        res.json({ success: true, data: prizes });
    } catch (error) {
        console.error('Get spin prizes error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/admin/spin-prizes
const createSpinPrize = async (req, res) => {
    const { name, prize_type, amount, weight, color } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Prize name required.' });
    try {
        await db.query(
            `INSERT INTO spin_prizes (name, prize_type, amount, weight, color) VALUES (?, ?, ?, ?, ?)`,
            [name, prize_type || 'usdt', parseFloat(amount) || 0, parseInt(weight) || 10, color || '#8B5CF6']
        );
        res.json({ success: true, message: 'Prize created.' });
    } catch (error) {
        console.error('Create spin prize error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/admin/spin-prizes/:id
const updateSpinPrize = async (req, res) => {
    const { id } = req.params;
    const { name, prize_type, amount, weight, color, is_active } = req.body;
    try {
        await db.query(
            `UPDATE spin_prizes SET name=?, prize_type=?, amount=?, weight=?, color=?, is_active=? WHERE id=?`,
            [name, prize_type || 'usdt', parseFloat(amount) || 0, parseInt(weight) || 10, color || '#8B5CF6', is_active ? 1 : 0, id]
        );
        res.json({ success: true, message: 'Prize updated.' });
    } catch (error) {
        console.error('Update spin prize error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// DELETE /api/admin/spin-prizes/:id
const deleteSpinPrize = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(`DELETE FROM spin_prizes WHERE id = ?`, [id]);
        res.json({ success: true, message: 'Prize deleted.' });
    } catch (error) {
        console.error('Delete spin prize error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/admin/points-records — full transaction log with user & referrer info
const getPointsRecords = async (req, res) => {
    try {
        const page     = parseInt(req.query.page)  || 1;
        const limit    = parseInt(req.query.limit)  || 50;
        const offset   = (page - 1) * limit;
        const username = req.query.username || '';
        const type     = req.query.type     || '';
        const dateFrom = req.query.date_from || '';

        let where = '1=1';
        const params = [];

        if (username) {
            where += ' AND u.username LIKE ?';
            params.push('%' + username + '%');
        }
        if (type) {
            where += ' AND t.type = ?';
            params.push(type);
        }
        if (dateFrom) {
            where += " AND DATE(t.created_at) >= DATE(?)";
            params.push(dateFrom);
        }

        const [records] = await db.query(
            `SELECT t.id, t.type, t.amount, t.balance_before, t.balance_after,
                    t.description, t.status, t.created_at,
                    u.username, u.id as user_id,
                    ref.username as referrer_username, ref.id as referrer_id
             FROM transactions t
             JOIN users u ON t.user_id = u.id
             LEFT JOIN users ref ON u.referred_by = ref.id
             WHERE ${where}
             ORDER BY t.id DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const [countRows] = await db.query(
            `SELECT COUNT(*) as total,
                    COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) as total_gained,
                    COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) as total_deducted,
                    COALESCE(SUM(t.amount), 0) as net_total
             FROM transactions t
             JOIN users u ON t.user_id = u.id
             LEFT JOIN users ref ON u.referred_by = ref.id
             WHERE ${where}`,
            params
        );

        const stats = countRows[0];
        res.json({
            success: true,
            data: {
                records,
                total_gained:   parseFloat(stats.total_gained   || 0).toFixed(2),
                total_deducted: parseFloat(stats.total_deducted || 0).toFixed(2),
                net_total:      parseFloat(stats.net_total      || 0).toFixed(2),
                pagination: {
                    page, limit,
                    total: stats.total,
                    pages: Math.ceil(stats.total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Get points records error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

module.exports = {
    adminLogin, getDashboard, getUsers, updateUserStatus, adjustBalance, setWithdrawalPassword,
    updateUserProfile, searchUsers, resetTaskVolume, toggleTransactionStatus, toggleTestStatus, getUserTeam, getUserTasks, addUserTask, deleteUserTask,
    getDeposits, approveDeposit, getWithdrawals, processWithdrawal,
    getProducts, createProduct, updateProduct, deleteProduct,
    getSettings, updateSettings,
    getVipLevels, updateVipLevel, addVipLevel, deleteVipLevel,
    getPrizeRecords, reviewPrizeRecord, deletePrizeRecord,
    getSpinPrizes, createSpinPrize, updateSpinPrize, deleteSpinPrize,
    getPointsRecords
};
