const db = require('../config/db');

// GET /api/user/profile
const getProfile = async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.username, u.email, u.full_name, u.phone, u.balance,
                    u.total_earned, u.vip_level, u.referral_code, u.avatar, u.status, u.created_at,
                    COALESCE(u.credit_score, 80) as credit_score,
                    v.name as vip_name, v.commission_rate, v.daily_task_limit, v.color as vip_color
             FROM users u
             LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`,
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Count referrals
        const [referrals] = await db.query(
            'SELECT COUNT(*) as total FROM users WHERE referred_by = ?',
            [req.user.id]
        );

        res.json({
            success: true,
            data: { ...users[0], total_referrals: referrals[0].total }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/user/dashboard
const getDashboard = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user basic info
        const [users] = await db.query(
            `SELECT u.balance, u.total_earned, u.vip_level, v.name as vip_name,
                    v.commission_rate, v.daily_task_limit, v.color as vip_color,
                    v.min_withdrawal, v.max_withdrawal, v.transaction_fee_rate
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`,
            [userId]
        );

        const user = users[0];
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        // Count today's completed tasks
        const [todayTasks] = await db.query(
            `SELECT COUNT(*) as count, COALESCE(SUM(commission_amount), 0) as earned
             FROM tasks WHERE user_id = ? AND status = 'completed'
             AND DATE(completed_at) = CURDATE()`,
            [userId]
        );

        // Count total completed tasks
        const [totalTasks] = await db.query(
            `SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND status = 'completed'`,
            [userId]
        );

        // Get recent transactions (last 5)
        const [recentTxns] = await db.query(
            `SELECT type, amount, description, status, created_at
             FROM transactions WHERE user_id = ?
             ORDER BY created_at DESC LIMIT 5`,
            [userId]
        );

        // Get pending tasks count
        const [pendingTasks] = await db.query(
            `SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND status = 'pending'`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                balance: user.balance,
                total_earned: user.total_earned,
                vip_level: user.vip_level,
                vip_name: user.vip_name,
                vip_color: user.vip_color,
                commission_rate: user.commission_rate,
                daily_task_limit: user.daily_task_limit,
                vip_min_withdrawal: parseFloat(user.min_withdrawal || 10),
                vip_max_withdrawal: parseFloat(user.max_withdrawal || 1000),
                vip_tx_fee_rate: parseFloat(user.transaction_fee_rate || 0),
                today_tasks_done: todayTasks[0].count,
                today_earned: todayTasks[0].earned,
                total_tasks_done: totalTasks[0].count,
                pending_tasks: pendingTasks[0].count,
                tasks_remaining: user.daily_task_limit - todayTasks[0].count,
                recent_transactions: recentTxns
            }
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/user/transactions
const getTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const type = req.query.type; // filter by type

        let query = 'SELECT * FROM transactions WHERE user_id = ?';
        let params = [req.user.id];

        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [transactions] = await db.query(query, params);
        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?',
            [req.user.id]
        );

        res.json({
            success: true,
            data: {
                transactions,
                pagination: {
                    page,
                    limit,
                    total: countResult[0].total,
                    pages: Math.ceil(countResult[0].total / limit)
                }
            }
        });

    } catch (error) {
        console.error('Transactions error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/user/deposit
const requestDeposit = async (req, res) => {
    const { amount, payment_method, txn_hash } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Valid amount is required.' });
    }

    try {
        // Get minimum deposit from settings
        const [settings] = await db.query(
            "SELECT setting_value FROM settings WHERE setting_key = 'min_deposit'"
        );
        const minDeposit = parseFloat(settings[0]?.setting_value || 10);

        if (parseFloat(amount) < minDeposit) {
            return res.status(400).json({
                success: false,
                message: `Minimum deposit is $${minDeposit}.`
            });
        }

        // Get deposit wallet address from settings
        const [walletSetting] = await db.query(
            "SELECT setting_value FROM settings WHERE setting_key = 'usdt_wallet'"
        );

        const [result] = await db.query(
            `INSERT INTO deposits (user_id, amount, payment_method, txn_hash)
             VALUES (?, ?, ?, ?)`,
            [req.user.id, amount, payment_method || 'USDT', txn_hash || null]
        );

        res.status(201).json({
            success: true,
            message: 'Deposit request submitted. Admin will review within 24 hours.',
            data: {
                deposit_id: result.insertId,
                amount,
                payment_method: payment_method || 'USDT',
                wallet_address: walletSetting[0]?.setting_value,
                status: 'pending'
            }
        });

    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/user/withdraw
const requestWithdrawal = async (req, res) => {
    const { amount, wallet_address, payment_method, withdrawal_password } = req.body;

    if (!amount || !wallet_address) {
        return res.status(400).json({ success: false, message: 'Amount and wallet address are required.' });
    }

    try {
        // Check withdrawal password if user has one set
        const [userRows] = await db.query('SELECT withdrawal_password FROM users WHERE id = ?', [req.user.id]);
        if (userRows.length > 0 && userRows[0].withdrawal_password) {
            if (!withdrawal_password) {
                return res.status(400).json({ success: false, message: 'Withdrawal password is required.' });
            }
            const bcrypt = require('bcryptjs');
            const match = await bcrypt.compare(withdrawal_password, userRows[0].withdrawal_password);
            if (!match) {
                return res.status(400).json({ success: false, message: 'Incorrect withdrawal password.' });
            }
        }

        // Get user's VIP level min/max withdrawal + current balance
        const [users] = await db.query(
            `SELECT u.balance, u.vip_level, v.name as vip_name,
                    v.min_withdrawal, v.max_withdrawal, v.transaction_fee_rate
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`,
            [req.user.id]
        );
        const userBalance = parseFloat(users[0].balance);
        const vipName = users[0].vip_name || 'your VIP';
        const minWithdrawal = parseFloat(users[0].min_withdrawal || 10);
        const maxWithdrawal = parseFloat(users[0].max_withdrawal || 999999);
        const feePercent    = parseFloat(users[0].transaction_fee_rate || 0) * 100; // stored as 0.02 = 2%

        // Fallback: also read global fee from settings if vip fee is 0
        const [settingsRows] = await db.query('SELECT setting_key, setting_value FROM settings');
        const settings = {};
        settingsRows.forEach(s => { settings[s.setting_key] = s.setting_value; });
        const effectiveFee = feePercent > 0 ? feePercent : parseFloat(settings.withdrawal_fee || 2);

        if (parseFloat(amount) < minWithdrawal) {
            return res.status(400).json({
                success: false,
                message: `Minimum withdrawal for ${vipName} level is $${minWithdrawal.toFixed(2)}. Your current balance is $${userBalance.toFixed(2)}.`
            });
        }

        if (parseFloat(amount) > maxWithdrawal) {
            return res.status(400).json({
                success: false,
                message: `Maximum withdrawal for ${vipName} level is $${maxWithdrawal.toFixed(2)} per request.`
            });
        }

        if (parseFloat(amount) > userBalance) {
            return res.status(400).json({ success: false, message: `Insufficient balance. Your balance is $${userBalance.toFixed(2)}.` });
        }

        const fee = (parseFloat(amount) * effectiveFee) / 100;
        const netAmount = parseFloat(amount) - fee;

        // Deduct from balance immediately (hold)
        await db.query('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, req.user.id]);

        // Create withdrawal request
        const [result] = await db.query(
            `INSERT INTO withdrawals (user_id, amount, fee, net_amount, payment_method, wallet_address)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.id, amount, fee, netAmount, payment_method || 'USDT', wallet_address]
        );

        // Log transaction
        await db.query(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, reference_id, status)
             VALUES (?, 'withdrawal', ?, ?, ?, ?, ?, 'pending')`,
            [req.user.id, amount, userBalance, userBalance - amount, `Withdrawal request - ${wallet_address}`, result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Withdrawal request submitted. Will be processed within 24 hours.',
            data: {
                withdrawal_id: result.insertId,
                amount,
                fee: fee.toFixed(2),
                net_amount: netAmount.toFixed(2),
                status: 'pending'
            }
        });

    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// PUT /api/user/profile
const updateProfile = async (req, res) => {
    const { full_name, phone } = req.body;

    try {
        await db.query(
            'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
            [full_name, phone, req.user.id]
        );

        res.json({ success: true, message: 'Profile updated successfully.' });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/user/spin-info
const getSpinInfo = async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.vip_level, v.task_wheel
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`,
            [req.user.id]
        );
        if (!users.length) return res.status(404).json({ success: false, message: 'User not found.' });
        const user = users[0];
        const maxSpins = parseInt(user.task_wheel) || 0;

        const [spinsToday] = await db.query(
            `SELECT COUNT(*) as count FROM prize_records WHERE user_id = ? AND DATE(created_at) = DATE('now')`,
            [req.user.id]
        );
        const spinsUsed = parseInt(spinsToday[0]?.count) || 0;
        const spinsLeft = Math.max(0, maxSpins - spinsUsed);

        const [prizes] = await db.query(
            `SELECT id, name, prize_type, amount, weight, color FROM spin_prizes WHERE is_active = 1 ORDER BY id ASC`
        );

        res.json({ success: true, data: { max_spins: maxSpins, spins_used: spinsUsed, spins_left: spinsLeft, prizes } });
    } catch (error) {
        console.error('Get spin info error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/user/spin
const doSpin = async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.vip_level, v.task_wheel
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`,
            [req.user.id]
        );
        if (!users.length) return res.status(404).json({ success: false, message: 'User not found.' });
        const user = users[0];
        const maxSpins = parseInt(user.task_wheel) || 0;
        if (maxSpins === 0) return res.status(400).json({ success: false, message: 'Your VIP level does not include spin access. Upgrade to unlock!' });

        const [spinsToday] = await db.query(
            `SELECT COUNT(*) as count FROM prize_records WHERE user_id = ? AND DATE(created_at) = DATE('now')`,
            [req.user.id]
        );
        const spinsUsed = parseInt(spinsToday[0]?.count) || 0;
        if (spinsUsed >= maxSpins) return res.status(400).json({ success: false, message: 'No spins left today. Come back tomorrow!' });

        const [prizes] = await db.query(
            `SELECT * FROM spin_prizes WHERE is_active = 1 ORDER BY id ASC`
        );
        if (!prizes.length) return res.status(400).json({ success: false, message: 'No prizes configured yet.' });

        // Weighted random selection
        const totalWeight = prizes.reduce((sum, p) => sum + (parseInt(p.weight) || 1), 0);
        let rand = Math.random() * totalWeight;
        let won = prizes[prizes.length - 1];
        for (const prize of prizes) {
            rand -= parseInt(prize.weight) || 1;
            if (rand <= 0) { won = prize; break; }
        }

        // Save prize record
        const status = won.prize_type === 'none' ? 'reviewed' : 'pending';
        await db.query(
            `INSERT INTO prize_records (user_id, prize_name, prize_type, amount, weight, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.id, won.name, won.prize_type, parseFloat(won.amount) || 0, won.weight, status]
        );

        const spinsLeft = Math.max(0, maxSpins - spinsUsed - 1);
        res.json({
            success: true,
            data: {
                won_prize_id: won.id,
                prize: { id: won.id, name: won.name, prize_type: won.prize_type, amount: won.amount, color: won.color },
                spins_left: spinsLeft,
                message: won.prize_type === 'none'
                    ? 'Better luck next time!'
                    : `Congratulations! You won ${won.name}! Admin will review and credit your balance shortly.`
            }
        });
    } catch (error) {
        console.error('Spin error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

module.exports = { getProfile, getDashboard, getTransactions, requestDeposit, requestWithdrawal, updateProfile, getSpinInfo, doSpin };
