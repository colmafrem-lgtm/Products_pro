// Creates and seeds the SQLite database
// Run: node init-db.js

const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../database/investpro.db');

async function init() {
    console.log('🔧 Initializing InvestPro database...\n');

    const SQL = await initSqlJs();

    // Load existing or create new
    let db;
    if (fs.existsSync(DB_FILE)) {
        const fileBuffer = fs.readFileSync(DB_FILE);
        db = new SQL.Database(fileBuffer);
        console.log('📂 Loaded existing database');
    } else {
        db = new SQL.Database();
        console.log('🆕 Creating new database');
    }

    function save() {
        const data = db.export();
        fs.writeFileSync(DB_FILE, Buffer.from(data));
    }

    function rows(sql, params) {
        const result = db.exec(sql, params);
        if (!result || result.length === 0) return [];
        const { columns, values } = result[0];
        return values.map(r => {
            const obj = {};
            columns.forEach((c, i) => obj[c] = r[i]);
            return obj;
        });
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS vip_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level INTEGER UNIQUE NOT NULL,
            name TEXT NOT NULL,
            min_deposit REAL NOT NULL,
            commission_rate REAL NOT NULL,
            daily_task_limit INTEGER NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#8B5CF6'
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            referral_code TEXT UNIQUE,
            referred_by INTEGER DEFAULT NULL,
            balance REAL DEFAULT 0.00,
            total_earned REAL DEFAULT 0.00,
            vip_level INTEGER DEFAULT 1,
            status TEXT DEFAULT 'active',
            avatar TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            image_url TEXT,
            category TEXT,
            commission_rate REAL DEFAULT 1.00,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            task_number INTEGER NOT NULL,
            product_price REAL NOT NULL,
            commission_amount REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            submitted_at TEXT DEFAULT NULL,
            completed_at TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_before REAL NOT NULL,
            balance_after REAL NOT NULL,
            description TEXT,
            reference_id INTEGER DEFAULT NULL,
            status TEXT DEFAULT 'completed',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_method TEXT DEFAULT 'USDT',
            wallet_address TEXT,
            txn_hash TEXT,
            status TEXT DEFAULT 'pending',
            admin_note TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            processed_at TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            fee REAL DEFAULT 0.00,
            net_amount REAL NOT NULL,
            payment_method TEXT DEFAULT 'USDT',
            wallet_address TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            admin_note TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            processed_at TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT,
            description TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );
    `);

    console.log('✅ Tables created!');

    // VIP Levels
    const vipCount = rows('SELECT COUNT(*) as c FROM vip_levels')[0].c;
    if (vipCount === 0) {
        [
            [1, 'Bronze',  0,    1.00, 10,  'Starter 1% commission',    '#CD7F32'],
            [2, 'Silver',  100,  1.50, 20,  'Silver 1.5% commission',   '#C0C0C0'],
            [3, 'Gold',    500,  2.00, 30,  'Gold 2% commission',       '#FFD700'],
            [4, 'Platinum',1000, 2.50, 50,  'Platinum 2.5% commission', '#E5E4E2'],
            [5, 'Diamond', 5000, 3.00, 100, 'Diamond 3% commission',    '#B9F2FF'],
        ].forEach(v => db.run(`INSERT INTO vip_levels (level,name,min_deposit,commission_rate,daily_task_limit,description,color) VALUES (?,?,?,?,?,?,?)`, v));
        console.log('✅ VIP levels seeded!');
    }

    // Products
    const prodCount = rows('SELECT COUNT(*) as c FROM products')[0].c;
    if (prodCount === 0) {
        [
            ['Running Sneakers',   'Premium athletic running shoes',              59.99, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400', 'Footwear',    1.50],
            ['Leather Backpack',   'Genuine leather business backpack',            79.99, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400', 'Bags',        1.50],
            ['Wireless Earbuds',   'Active noise cancelling earbuds 30hr battery', 89.99, 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400', 'Electronics', 2.00],
            ['Smart Watch',        'Health monitoring smartwatch with GPS',        149.99,'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400', 'Electronics', 2.00],
            ['Yoga Mat',           'Non-slip premium yoga mat',                    35.99, 'https://images.unsplash.com/photo-1601925228516-e1b9f39f1f4d?w=400', 'Sports',      1.00],
            ['Coffee Maker',       'Drip coffee maker with thermal carafe',        65.99, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400', 'Kitchen',     1.50],
            ['Sunglasses',         'Polarized UV400 protection sunglasses',        45.99, 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400', 'Accessories', 1.00],
            ['Bluetooth Speaker',  'Waterproof bluetooth speaker 20W',             55.99, 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400', 'Electronics', 2.00],
            ['Skincare Set',       'Korean skincare routine set',                  49.99, 'https://images.unsplash.com/photo-1556228578-b2f3892d3c6a?w=400', 'Beauty',      1.50],
            ['Gaming Mouse',       'RGB gaming mouse 16000 DPI',                   39.99, 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400', 'Electronics', 1.50],
            ['Silk Scarf',         'Pure silk hand-painted designer scarf',        29.99, 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=400', 'Fashion',     1.00],
            ['Fitness Band',       'Smart fitness tracker with heart rate monitor',39.99, 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=400', 'Sports',      1.50],
        ].forEach(p => db.run(`INSERT INTO products (name,description,price,image_url,category,commission_rate) VALUES (?,?,?,?,?,?)`, p));
        console.log('✅ Products seeded!');
    }

    // Admin
    const adminCount = rows('SELECT COUNT(*) as c FROM admins')[0].c;
    if (adminCount === 0) {
        const hash = bcrypt.hashSync('Admin@123', 10);
        db.run(`INSERT INTO admins (username,email,password,role) VALUES (?,?,?,?)`,
            ['admin', 'admin@investpro.com', hash, 'superadmin']);
        console.log('✅ Admin created!  username: admin  password: Admin@123');
    }

    // Settings
    const settCount = rows('SELECT COUNT(*) as c FROM settings')[0].c;
    if (settCount === 0) {
        [
            ['site_name',        'InvestPro',             'Website name'],
            ['site_logo',        '',                      'Logo URL'],
            ['min_deposit',      '10',                    'Min deposit $'],
            ['min_withdrawal',   '20',                    'Min withdrawal $'],
            ['withdrawal_fee',   '2',                     'Withdrawal fee %'],
            ['referral_bonus',   '5',                     'Referral bonus $'],
            ['maintenance_mode', 'false',                 'Maintenance mode'],
            ['usdt_wallet',      'TYourWalletHere',       'USDT TRC20 wallet'],
            ['support_email',    'support@investpro.com', 'Support email'],
            ['support_telegram', '@investpro_support',    'Telegram handle'],
        ].forEach(s => db.run(`INSERT INTO settings (setting_key,setting_value,description) VALUES (?,?,?)`, s));
        console.log('✅ Settings seeded!');
    }

    save();
    console.log('\n🎉 Database ready!');
    console.log('📁 File:', DB_FILE);
    console.log('\n👉 Now run: node server.js\n');
    db.close();
}

init().catch(console.error);
