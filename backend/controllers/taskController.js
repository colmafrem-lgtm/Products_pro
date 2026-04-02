const db = require('../config/db');

// GET /api/tasks/available  — get next task for user
const getAvailableTask = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get user info
        const [users] = await db.query(
            `SELECT u.balance, u.vip_level, u.is_test, u.task_reset_at, v.commission_rate, v.daily_task_limit
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`,
            [userId]
        );

        const user = users[0];
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        // Default daily limit to 10 if VIP level not found or limit is null/0
        const dailyLimit = parseInt(user.daily_task_limit) || 10;
        const taskResetAt = user.task_reset_at || null;

        // Count today's completed tasks (after last VIP reset if any)
        const [todayDone] = await db.query(
            `SELECT COUNT(*) as count FROM tasks
             WHERE user_id = ? AND status = 'completed'
             AND DATE(completed_at) = date('now')
             AND (? IS NULL OR completed_at >= ?)`,
            [userId, taskResetAt, taskResetAt]
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

        // Auto-assign task if user has balance >= 50
        const userBalance = parseFloat(user.balance) || 0;
        if (userBalance >= 50) {
            // Price range per VIP level
            const vipPriceRange = {
                1: { min: 20,   max: 150   },
                2: { min: 150,  max: 2000  },
                3: { min: 700,  max: 15000 },
                4: { min: 2000, max: 25000 },
            };
            const vipLevel = parseInt(user.vip_level) || 1;
            const range = vipPriceRange[vipLevel] || vipPriceRange[1];

            // Get today's already-used product IDs
            const [usedRows] = await db.query(
                `SELECT product_id FROM tasks WHERE user_id = ? AND date(created_at) = date('now')`,
                [userId]
            );
            const usedIds = usedRows.map(r => r.product_id);

            let productQuery = `SELECT * FROM products WHERE status='active' AND price >= ? AND price <= ?`;
            const productParams = [range.min, range.max];
            if (usedIds.length > 0) {
                productQuery += ` AND id NOT IN (${usedIds.map(() => '?').join(',')})`;
                productParams.push(...usedIds);
            }
            productQuery += ` ORDER BY RANDOM() LIMIT 1`;

            const [products] = await db.query(productQuery, productParams);

            if (products.length > 0) {
                const product = products[0];
                const commissionRate = parseFloat(user.commission_rate) || 1.0;
                const commissionAmount = parseFloat((product.price * commissionRate / 100).toFixed(2));

                const [result] = await db.query(
                    `INSERT INTO tasks (user_id, product_id, task_number, product_price, commission_amount, status, created_at)
                     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
                    [userId, product.id, doneToday + 1, product.price, commissionAmount]
                );

                const newTask = {
                    id: result.insertId,
                    user_id: userId,
                    product_id: product.id,
                    task_number: doneToday + 1,
                    product_price: product.price,
                    commission_amount: commissionAmount,
                    status: 'pending',
                    product_name: product.name,
                    description: product.description,
                    price: product.price,
                    image_url: product.image_url,
                    category: product.category
                };

                return res.json({
                    success: true,
                    message: 'Task ready!',
                    data: {
                        task: newTask,
                        tasks_done: doneToday,
                        daily_limit: dailyLimit,
                        tasks_remaining: dailyLimit - doneToday
                    }
                });
            }
        }

        // No products or balance too low
        return res.json({
            success: false,
            message: 'No tasks assigned yet. Please wait for admin to set up your tasks.',
            data: {
                tasks_done: doneToday,
                daily_limit: dailyLimit,
                no_products: true,
                user_balance: userBalance
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
            `UPDATE tasks SET status = 'completed', submitted_at = datetime('now'), completed_at = datetime('now') WHERE id = ?`,
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
