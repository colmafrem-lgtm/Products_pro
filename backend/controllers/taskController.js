const db = require('../config/db');

// GET /api/tasks/available  — get next task for user
const getAvailableTask = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user info
        const [users] = await db.query(
            `SELECT u.balance, u.vip_level, u.is_test, v.commission_rate, v.daily_task_limit
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`,
            [userId]
        );

        const user = users[0];
        // Default daily limit to 10 if VIP level not found or limit is null/0
        const dailyLimit = parseInt(user.daily_task_limit) || 10;

        // Count today's completed tasks
        const [todayDone] = await db.query(
            `SELECT COUNT(*) as count FROM tasks
             WHERE user_id = ? AND status = 'completed' AND DATE(completed_at) = CURDATE()`,
            [userId]
        );

        const doneToday = parseInt(todayDone[0].count) || 0;

        // Check daily limit
        if (doneToday >= dailyLimit) {
            return res.json({
                success: false,
                message: `Daily task limit reached (${dailyLimit} tasks). Come back tomorrow!`,
                data: {
                    tasks_done: doneToday,
                    daily_limit: dailyLimit,
                    limit_reached: true
                }
            });
        }

        // Check if user has pending task
        const [pendingTasks] = await db.query(
            `SELECT t.*, p.name as product_name, p.description, p.price,
                    p.image_url, p.category
             FROM tasks t JOIN products p ON t.product_id = p.id
             WHERE t.user_id = ? AND t.status = 'pending'
             ORDER BY t.created_at ASC LIMIT 1`,
            [userId]
        );

        if (pendingTasks.length > 0) {
            return res.json({
                success: true,
                message: 'You have a pending task to complete.',
                data: {
                    task: pendingTasks[0],
                    tasks_done: doneToday,
                    daily_limit: dailyLimit,
                    tasks_remaining: dailyLimit - doneToday
                }
            });
        }

        // No admin-assigned tasks available — show locked form
        return res.json({
            success: false,
            message: 'No tasks assigned yet. Please wait for admin to set up your tasks.',
            data: {
                tasks_done: doneToday,
                daily_limit: dailyLimit,
                no_products: true,
                user_balance: parseFloat(user.balance) || 0
            }
        });

    } catch (error) {
        console.error('Get task error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// POST /api/tasks/:id/submit  — submit/complete a task
const submitTask = async (req, res) => {
    const taskId = req.params.id;
    const userId = req.user.id;

    try {
        // Get task details
        const [tasks] = await db.query(
            `SELECT t.*, p.name as product_name FROM tasks t
             JOIN products p ON t.product_id = p.id
             WHERE t.id = ? AND t.user_id = ?`,
            [taskId, userId]
        );

        if (tasks.length === 0) {
            return res.status(404).json({ success: false, message: 'Task not found.' });
        }

        const task = tasks[0];

        if (task.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Task already completed or cancelled.' });
        }

        const commission = parseFloat(task.commission_amount);

        // Update task status
        await db.query(
            `UPDATE tasks SET status = 'completed', submitted_at = NOW(), completed_at = NOW() WHERE id = ?`,
            [taskId]
        );

        // Get user info (check is_test)
        const [userRows] = await db.query('SELECT balance, total_earned, is_test FROM users WHERE id = ?', [userId]);
        const currentBalance = parseFloat(userRows[0].balance);
        const isTestUser = userRows[0].is_test;

        // Test users: do NOT update real balance or total_earned
        const newBalance = isTestUser ? currentBalance : currentBalance + commission;
        const newTotalEarned = isTestUser ? parseFloat(userRows[0].total_earned) : parseFloat(userRows[0].total_earned) + commission;

        await db.query(
            'UPDATE users SET balance = ?, total_earned = ? WHERE id = ?',
            [newBalance, newTotalEarned, userId]
        );

        // Log transaction
        await db.query(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, reference_id, status)
             VALUES (?, 'commission', ?, ?, ?, ?, ?, 'completed')`,
            [userId, commission, currentBalance, newBalance, `Commission from task #${task.task_number}: ${task.product_name}`, taskId]
        );

        // Check if user qualifies for VIP upgrade
        const [updatedUser] = await db.query(
            'SELECT balance, vip_level FROM users WHERE id = ?',
            [userId]
        );

        const [vipLevels] = await db.query(
            'SELECT * FROM vip_levels ORDER BY level ASC'
        );

        let newVipLevel = updatedUser[0].vip_level;
        for (const vip of vipLevels) {
            if (newTotalEarned >= vip.min_deposit) {
                newVipLevel = vip.level;
            }
        }

        if (newVipLevel !== updatedUser[0].vip_level) {
            await db.query('UPDATE users SET vip_level = ? WHERE id = ?', [newVipLevel, userId]);
        }

        res.json({
            success: true,
            message: `Task completed! You earned $${commission.toFixed(2)}`,
            data: {
                commission_earned: commission.toFixed(2),
                new_balance: newBalance.toFixed(2),
                task_number: task.task_number
            }
        });

    } catch (error) {
        console.error('Submit task error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/tasks/history
const getTaskHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const [tasks] = await db.query(
            `SELECT t.*, p.name as product_name, p.image_url
             FROM tasks t JOIN products p ON t.product_id = p.id
             WHERE t.user_id = ?
             ORDER BY t.created_at DESC
             LIMIT ? OFFSET ?`,
            [req.user.id, limit, offset]
        );

        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM tasks WHERE user_id = ?',
            [req.user.id]
        );

        res.json({
            success: true,
            data: {
                tasks,
                pagination: {
                    page,
                    limit,
                    total: countResult[0].total,
                    pages: Math.ceil(countResult[0].total / limit)
                }
            }
        });

    } catch (error) {
        console.error('Task history error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

// GET /api/products  — list all active products
const getProducts = async (req, res) => {
    try {
        const [products] = await db.query(
            'SELECT * FROM products WHERE status = ? ORDER BY created_at DESC',
            ['active']
        );

        res.json({ success: true, data: products });

    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};

module.exports = { getAvailableTask, submitTask, getTaskHistory, getProducts };
