const db = require('../config/db');
const { sendToUser, sendToAdmins } = require('../utils/sse');

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
            // Recalculate commission from current VIP rate so displayed value matches earned value
            const commissionRate = parseFloat(user.commission_rate) || 0.5;
            const productPrice = parseFloat(pendingTasks[0].price);
            const freshCommission = Math.max(0.01, parseFloat((productPrice * commissionRate / 100).toFixed(2)));
            await db.query(`UPDATE tasks SET commission_amount = ? WHERE id = ?`, [freshCommission, pendingTasks[0].id]);
            pendingTasks[0].commission_amount = freshCommission;

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

        // Auto-assign ALL remaining tasks at once if user has balance >= 50
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

            // Get all eligible products (price <= balance, in VIP range)
            const [allProducts] = await db.query(
                `SELECT * FROM products WHERE status='active' AND price >= ? AND price <= ? ORDER BY RANDOM()`,
                [range.min, userBalance]
            );

            if (allProducts.length === 0) {
                return res.json({
                    success: false,
                    message: 'No tasks assigned yet. Please wait for admin to set up your tasks.',
                    data: { tasks_done: doneToday, daily_limit: dailyLimit, no_products: true, user_balance: userBalance }
                });
            }

            const commissionRate = parseFloat(user.commission_rate) || 0.5;
            const tasksToGenerate = dailyLimit - doneToday;

            // Generate all remaining tasks at once so admin can see them all upfront
            for (let i = 0; i < tasksToGenerate; i++) {
                const product = allProducts[i % allProducts.length]; // cycle if not enough unique products
                const commissionAmount = Math.max(0.01, parseFloat((product.price * commissionRate / 100).toFixed(2)));
                await db.query(
                    `INSERT INTO tasks (user_id, product_id, task_number, product_price, commission_amount, status, created_at)
                     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`,
                    [userId, product.id, doneToday + i + 1, product.price, commissionAmount]
                );
            }

            // Return the first pending task
            const [newPending] = await db.query(
                `SELECT t.*, p.name as product_name, p.description, p.price, p.image_url, p.category
                 FROM tasks t JOIN products p ON t.product_id = p.id
                 WHERE t.user_id = ? AND t.status = 'pending'
                 ORDER BY t.task_number ASC LIMIT 1`,
                [userId]
            );

            if (newPending.length > 0) {
                return res.json({
                    success: true,
                    message: 'Task ready!',
                    data: {
                        task: newPending[0],
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

        // Get current user info + VIP commission rate + referrer
        const [userCheck] = await db.query(
            `SELECT u.balance, u.total_earned, u.is_test, u.referred_by, u.username, v.commission_rate
             FROM users u LEFT JOIN vip_levels v ON u.vip_level = v.level
             WHERE u.id = ?`, [userId]
        );
        const currentBalanceCheck = parseFloat(userCheck[0].balance);
        const productPrice = parseFloat(task.product_price);

        // Check user balance >= product price
        if (currentBalanceCheck < productPrice) {
            const needed = (productPrice - currentBalanceCheck).toFixed(2);
            return res.status(400).json({
                success: false,
                insufficient_balance: true,
                message: `Insufficient balance`,
                data: {
                    product_price: productPrice.toFixed(2),
                    current_balance: currentBalanceCheck.toFixed(2),
                    amount_needed: needed
                }
            });
        }

        // Always recalculate commission from current VIP rate (not stored value)
        const vipRate = parseFloat(userCheck[0].commission_rate) || 0.5;
        const commission = Math.max(0.01, parseFloat((productPrice * vipRate / 100).toFixed(2)));

        // Update task with recalculated commission
        await db.query(`UPDATE tasks SET commission_amount = ? WHERE id = ?`, [commission, taskId]);

        // Update task status
        await db.query(
            `UPDATE tasks SET status = 'completed', submitted_at = datetime('now'), completed_at = datetime('now') WHERE id = ?`,
            [taskId]
        );

        // Use already-fetched user data
        const currentBalance = currentBalanceCheck;
        const isTestUser = userCheck[0].is_test;

        // Test users: do NOT update real balance or total_earned
        const newBalance = isTestUser ? currentBalance : currentBalance + commission;
        const newTotalEarned = isTestUser ? parseFloat(userCheck[0].total_earned) : parseFloat(userCheck[0].total_earned) + commission;

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

        // Count tasks done today for SSE payload
        const [doneTodayRows] = await db.query(
            `SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND status = 'completed' AND DATE(completed_at) = date('now')`,
            [userId]
        );
        const tasksDone = parseInt(doneTodayRows[0].count) || 0;

        res.json({
            success: true,
            message: `Task completed! You earned $${commission.toFixed(2)}`,
            data: {
                commission_earned: commission.toFixed(2),
                new_balance: newBalance.toFixed(2),
                task_number: task.task_number
            }
        });

        sendToUser(userId, 'task_completed', {
            commission: commission.toFixed(2),
            new_balance: newBalance.toFixed(2),
            tasks_done: tasksDone
        });

        // Referral bonus: give 20% of commission earned to referrer (account 1)
        if (!isTestUser) {
            const referrerId = userCheck[0].referred_by;
            if (referrerId) {
                const bonusAmount = parseFloat((commission * 0.20).toFixed(2));
                if (bonusAmount > 0) {
                    const [referrerRows] = await db.query('SELECT id, username, balance FROM users WHERE id = ?', [referrerId]);
                    if (referrerRows.length > 0) {
                        const referrer = referrerRows[0];
                        const referrerOldBalance = parseFloat(referrer.balance);
                        const referrerNewBalance = parseFloat((referrerOldBalance + bonusAmount).toFixed(2));

                        await db.query('UPDATE users SET balance = ?, total_earned = total_earned + ? WHERE id = ?', [referrerNewBalance, bonusAmount, referrerId]);
                        await db.query(
                            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, status)
                             VALUES (?, 'referral_bonus', ?, ?, ?, ?, 'completed')`,
                            [referrerId, bonusAmount, referrerOldBalance, referrerNewBalance,
                             `Referral bonus 20% from ${userCheck[0].username}'s task commission $${commission.toFixed(2)}`]
                        );

                        sendToUser(referrerId, 'referral_bonus', {
                            bonus: bonusAmount.toFixed(2),
                            new_balance: referrerNewBalance.toFixed(2),
                            from_user: userCheck[0].username,
                            commission_amount: commission.toFixed(2)
                        });
                    }
                }
            }
        }

        // Notify admin panel — update task state in Order Settings live
        sendToAdmins('task_state_change', {
            user_id: userId,
            task_id: parseInt(taskId),
            status: 'completed'
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
        const status = req.query.status || '';

        const statusClause = status ? ` AND t.status = ?` : '';
        const countStatusClause = status ? ` AND status = ?` : '';
        const params = status ? [req.user.id, status, limit, offset] : [req.user.id, limit, offset];
        const countParams = status ? [req.user.id, status] : [req.user.id];

        const [tasks] = await db.query(
            `SELECT t.*, p.name as product_name, p.image_url, p.price as current_price
             FROM tasks t JOIN products p ON t.product_id = p.id
             WHERE t.user_id = ?${statusClause}
             ORDER BY t.created_at DESC
             LIMIT ? OFFSET ?`,
            params
        );

        const [countResult] = await db.query(
            `SELECT COUNT(*) as total FROM tasks WHERE user_id = ?${countStatusClause}`,
            countParams
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
