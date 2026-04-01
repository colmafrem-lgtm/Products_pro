const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// Generate random referral code
function generateReferralCode(username) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = username.toUpperCase().substring(0, 3);
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// POST /api/auth/register
const register = async (req, res) => {
    const { username, email, password, full_name, phone, referral_code } = req.body;

    // Basic validation
    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Username, email and password are required.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    try {
        // Check if username or email already exists
        const [existing] = await db.query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Username or email already exists.' });
        }

        // Check referral code if provided
        let referredBy = null;
        if (referral_code) {
            const [referrer] = await db.query(
                'SELECT id FROM users WHERE referral_code = ?',
                [referral_code]
            );
            if (referrer.length > 0) {
                referredBy = referrer[0].id;
            }
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate unique referral code for new user
        const newReferralCode = generateReferralCode(username);

        // Insert user
        const [result] = await db.query(
            `INSERT INTO users (username, email, password, full_name, phone, referral_code, referred_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [username, email, hashedPassword, full_name || '', phone || '', newReferralCode, referredBy]
        );

        // If referred, give referral bonus to referrer
        if (referredBy) {
            const [referrerData] = await db.query('SELECT balance FROM users WHERE id = ?', [referredBy]);
            const settings = await getSettings();
            const bonus = parseFloat(settings.referral_bonus || 5);

            // Give small bonus to referrer (example: $5 bonus)
            await db.query(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [bonus, referredBy]
            );

            // Log transaction
            const newBalance = parseFloat(referrerData[0].balance) + bonus;
            await db.query(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, status)
                 VALUES (?, 'commission', ?, ?, ?, ?, 'completed')`,
                [referredBy, bonus, referrerData[0].balance, newBalance, `Referral bonus - new user: ${username}`]
            );
        }

        // Auto-login: issue JWT token so user goes directly to dashboard
        const newUserId = result.insertId;
        const token = jwt.sign(
            { id: newUserId, username, email, vip_level: 1 },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful!',
            data: {
                token,
                user: {
                    id: newUserId,
                    username,
                    email,
                    full_name: full_name || '',
                    balance: 0,
                    total_earned: 0,
                    vip_level: 1,
                    referral_code: newReferralCode
                }
            }
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
};

// POST /api/auth/login
const login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    try {
        // Find user by username or email
        const [users] = await db.query(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, username]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        const user = users[0];

        // Check account status
        if (user.status === 'suspended') {
            return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        // Create JWT token
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, vip_level: user.vip_level },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful!',
            data: {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    full_name: user.full_name,
                    balance: user.balance,
                    total_earned: user.total_earned,
                    vip_level: user.vip_level,
                    referral_code: user.referral_code
                }
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
};

// Helper: Get settings from DB
async function getSettings() {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM settings');
    const settings = {};
    rows.forEach(row => { settings[row.setting_key] = row.setting_value; });
    return settings;
}

module.exports = { register, login };
