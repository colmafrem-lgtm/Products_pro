const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
// DB_PATH env var lets Railway volume override default path
const DB_FILE = process.env.DB_PATH || path.join(__dirname, '../database/investpro.db');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Serve Frontend & Admin as Static Files ───────────────────────────────────
app.use('/uploads',  express.static(path.join(__dirname, 'uploads')));
app.use('/admin',    express.static(path.join(__dirname, '../admin')));
app.use('/',         express.static(path.join(__dirname, '../frontend')));

async function startServer() {
    // Load sql.js + open DB
    const SQL = await initSqlJs();
    // Auto-create DB directory if needed (Railway volume mount)
    const dbDir = path.dirname(DB_FILE);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    // Recovery: find the best DB (most users) among ALL candidate directories
    console.log(`🗄️  DB_FILE target: ${DB_FILE}`);
    const dbNames = ['investpro.db','investpro_v1.db','investpro_v2.db','investpro_v3.db','investpro_v4.db','investpro_backup.db'];
    // Always scan both the configured dir AND /data/ (Railway volume default)
    const scanDirs = [...new Set([dbDir, '/data', '/tmp/investpro', path.join(__dirname, '../database')])];
    let bestFile = null;
    let bestUserCount = -1;
    for (const scanDir of scanDirs) {
        if (!fs.existsSync(scanDir)) continue;
        // Also scan any .db files in directory (not just predefined names)
        let dirFiles = [];
        try { dirFiles = fs.readdirSync(scanDir).filter(f => f.endsWith('.db')); } catch(e) {}
        const toCheck = [...new Set([...dbNames, ...dirFiles])];
        for (const name of toCheck) {
            const candidate = path.join(scanDir, name);
            if (!fs.existsSync(candidate)) continue;
            try {
                const SQL2 = await initSqlJs();
                const tmpDb = new SQL2.Database(fs.readFileSync(candidate));
                const result = tmpDb.exec(`SELECT COUNT(*) as c FROM users`);
                const count = result[0]?.values[0][0] || 0;
                tmpDb.close();
                console.log(`📂 Found ${candidate}: ${count} users`);
                if (count > bestUserCount) { bestUserCount = count; bestFile = candidate; }
            } catch(e) { /* not a valid db */ }
        }
    }
    if (bestFile && bestUserCount > 0) {
        if (bestFile !== DB_FILE) {
            console.log(`♻️  Recovering DB from ${bestFile} (${bestUserCount} users) → ${DB_FILE}`);
            fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
            fs.copyFileSync(bestFile, DB_FILE);
        } else {
            console.log(`✅ Using existing DB at ${DB_FILE} (${bestUserCount} users)`);
        }
    } else if (!fs.existsSync(DB_FILE)) {
        console.log('🆕 No existing DB found — will create fresh');
    }

    const isNewDb = !fs.existsSync(DB_FILE);
    const sqliteDb = isNewDb
        ? new SQL.Database()
        : new SQL.Database(fs.readFileSync(DB_FILE));
    sqliteDb.run('PRAGMA foreign_keys = ON');

    // Save backup to /data/ immediately after loading (protects against future volume issues)
    try {
        const backupDir = '/data';
        if (fs.existsSync(backupDir) || dbDir === backupDir) {
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupPath = path.join(backupDir, 'investpro_backup.db');
            if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, backupPath);
        }
    } catch(e) { /* /data may not be available locally */ }

    const db = require('./config/db');
    db._init(sqliteDb);
    console.log('✅ SQLite database connected');

    // ─── Full Schema Init (runs only on fresh DB) ─────────────────────────────
    if (isNewDb) {
        console.log('🆕 Fresh database detected — creating schema...');
        const bcrypt = require('bcryptjs');

        sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS vip_levels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level INTEGER UNIQUE NOT NULL,
                name TEXT NOT NULL,
                min_deposit REAL NOT NULL,
                commission_rate REAL NOT NULL,
                daily_task_limit INTEGER NOT NULL,
                description TEXT,
                color TEXT DEFAULT '#8B5CF6',
                task_wheel INTEGER DEFAULT 1,
                task_set_size INTEGER DEFAULT 10,
                task_commission_multiplier REAL DEFAULT 1.0
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE,
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
                withdrawal_password TEXT DEFAULT NULL,
                transaction_disabled INTEGER DEFAULT 0,
                is_test INTEGER DEFAULT 0,
                credit_score INTEGER DEFAULT 80,
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
            CREATE TABLE IF NOT EXISTS prize_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                prize_name TEXT NOT NULL,
                prize_value REAL DEFAULT 0,
                prize_type TEXT DEFAULT 'spin',
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS spin_prizes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                prize_type TEXT DEFAULT 'usdt',
                amount REAL DEFAULT 0,
                weight INTEGER DEFAULT 10,
                color TEXT DEFAULT '#8B5CF6',
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            );
        `);

        // Seed VIP levels
        [[1,'Bronze',0,1.00,10,'Starter 1% commission','#CD7F32'],
         [2,'Silver',100,1.50,20,'Silver 1.5% commission','#C0C0C0'],
         [3,'Gold',500,2.00,30,'Gold 2% commission','#FFD700'],
         [4,'Platinum',1000,2.50,50,'Platinum 2.5% commission','#E5E4E2'],
         [5,'Diamond',5000,3.00,100,'Diamond 3% commission','#B9F2FF'],
        ].forEach(v => sqliteDb.run(
            `INSERT OR IGNORE INTO vip_levels (level,name,min_deposit,commission_rate,daily_task_limit,description,color) VALUES (?,?,?,?,?,?,?)`, v));

        // Seed admin account
        const adminHash = bcrypt.hashSync('Admin@123', 10);
        sqliteDb.run(`INSERT OR IGNORE INTO admins (username,email,password,role) VALUES (?,?,?,?)`,
            ['admin','admin@investpro.com', adminHash,'superadmin']);

        // Seed settings
        [['site_name','InvestPro','Website name'],
         ['min_deposit','10','Min deposit $'],
         ['min_withdrawal','20','Min withdrawal $'],
         ['withdrawal_fee','2','Withdrawal fee %'],
         ['referral_bonus','5','Referral bonus $'],
         ['maintenance_mode','false','Maintenance mode'],
         ['usdt_wallet','TYourWalletHere','USDT TRC20 wallet'],
         ['support_email','support@investpro.com','Support email'],
         ['support_telegram','https://t.me/CodefinityCS','Telegram handle'],
         ['telegram_link','https://t.me/CodefinityCS','Telegram link for deposit page'],
         ['whatsapp_link','https://wa.me/12352178513','WhatsApp link for deposit page'],
         ['withdrawal_limit_message','Your withdrawal limit has been reached. Please contact your account manager to continue.','Alert shown when withdrawal limit reached'],
         ['invitation_codes',JSON.stringify([
             {name:'Moneymagnet',code:'yma2to'},
             {name:'Tata',code:'ta6tai'},
             {name:'Terence',code:'er9nce'},
             {name:'Kelvin',code:'ke4ivn'},
             {name:'Snow',code:'wn7osi'},
             {name:'Morningstar',code:'gm8ins'},
             {name:'Anika',code:'an1gfk'},
             {name:'Wisdom',code:'Sh2iur'},
             {name:'Bobo',code:'bo3hjm'},
             {name:'Papi',code:'P4piag'},
             {name:'Felisha',code:'fe6tsi'},
             {name:'Lafy',code:'i5afyl'},
             {name:'Nathacha',code:'Sgskj7'},
             {name:'Sweet pioson',code:'Wiudk9'},
             {name:'Luckyman',code:'znj0fh'}
         ]),'Staff invitation codes list'],
        ].forEach(s => sqliteDb.run(
            `INSERT OR IGNORE INTO settings (setting_key,setting_value,description) VALUES (?,?,?)`, s));

        // Force-set contact links — always overwrite to ensure correct values on every deploy
        [['support_telegram','https://t.me/CodefinityCS','Telegram handle'],
         ['telegram_link','https://t.me/CodefinityCS','Telegram link for deposit page'],
         ['whatsapp_link','https://wa.me/12352178513','WhatsApp link for deposit page'],
        ].forEach(s => sqliteDb.run(
            `INSERT INTO settings (setting_key,setting_value,description) VALUES (?,?,?)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`, s));

        // Seed spin prizes (columns: name, prize_type, amount, weight, color)
        [['Better Luck Next Time','none',0,40,'#9CA3AF'],
         ['$1 Bonus','usdt',1,25,'#10B981'],
         ['$3 Bonus','usdt',3,15,'#3B82F6'],
         ['$5 Bonus','usdt',5,10,'#8B5CF6'],
         ['$10 Bonus','usdt',10,6,'#F59E0B'],
         ['$20 Bonus','usdt',20,3,'#EF4444'],
         ['Jackpot $100','usdt',100,1,'#EC4899'],
        ].forEach(p => sqliteDb.run(
            `INSERT OR IGNORE INTO spin_prizes (name,prize_type,amount,weight,color) VALUES (?,?,?,?,?)`, p));

        // Save fresh schema to file
        const data = sqliteDb.export();
        fs.writeFileSync(DB_FILE, Buffer.from(data));
        console.log('✅ Fresh schema + admin seeded! Login: admin / Admin@123');
    }

    // Seed event settings if they don't exist (safe for existing DBs)
    const eventSeeds = [
        ['event_countdown_date', '2026-04-08T00:00:00', 'Event countdown target date'],
        ['event_featured', JSON.stringify({icon:'🎁',badge:'LIVE NOW',title:'Double Commission Weekend',description:"Complete any task this weekend and earn 2\u00d7 your normal commission rate. All VIP levels qualify \u2014 don't miss out on this limited-time boost to your earnings!",schedule:'Sat\u2013Sun only',audience:'All members',status:'active'}), 'Featured event data'],
        ['events_upcoming', JSON.stringify([{title:'New Member Bonus \u2014 $10 Free',description:'Register and complete your first 5 tasks to receive a $10 bonus credited directly to your wallet.',tag:'New Members',tagColor:'#7C3AED',tagBg:'#EDE9FE',date:'Ongoing',accentColor:'linear-gradient(#8B5CF6,#EC4899)'},{title:'Referral Bonus Boost +50%',description:'Refer a friend this month and earn 50% extra on top of your normal referral bonus when they make their first deposit.',tag:'Referral',tagColor:'#D97706',tagBg:'#FEF3C7',date:'Apr 1 \u2013 Apr 30',accentColor:'linear-gradient(#F59E0B,#EF4444)'},{title:'VIP Upgrade Discount',description:'Upgrade to Gold or Platinum VIP this week and get 15% off the minimum deposit requirement. Limited time only!',tag:'VIP',tagColor:'#065F46',tagBg:'#D1FAE5',date:'Apr 5 \u2013 Apr 12',accentColor:'linear-gradient(#10B981,#3B82F6)'},{title:'Top Earner Leaderboard',description:'The top 10 earners this month will split a $500 bonus prize pool. Check your rank on the leaderboard now!',tag:'Contest',tagColor:'#4338CA',tagBg:'#E0E7FF',date:'Apr 1 \u2013 Apr 30',accentColor:'linear-gradient(#6366F1,#8B5CF6)'}]), 'Upcoming events data']
    ];
    let eventSeedChanged = false;
    for (const [k, v, d] of eventSeeds) {
        try {
            sqliteDb.run(`INSERT OR IGNORE INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?)`, [k, v, d]);
            eventSeedChanged = true;
        } catch(e) { /* table may not exist yet */ }
    }
    if (eventSeedChanged) {
        try { const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData)); } catch(e) {}
        console.log('✅ Event settings seeded (if not already present)');
    }

    // Seed invitation codes (safe for existing DBs — always ensure codes exist)
    try {
        const invDefault = JSON.stringify([
            {name:'Moneymagnet',code:'yma2to'},
            {name:'Tata',code:'ta6tai'},
            {name:'Terence',code:'er9nce'},
            {name:'Kelvin',code:'ke4ivn'},
            {name:'Snow',code:'wn7osi'},
            {name:'Morningstar',code:'gm8ins'},
            {name:'Anika',code:'an1gfk'},
            {name:'Wisdom',code:'Sh2iur'},
            {name:'Bobo',code:'bo3hjm'},
            {name:'Papi',code:'P4piag'},
            {name:'Felisha',code:'fe6tsi'},
            {name:'Lafy',code:'i5afyl'},
            {name:'Nathacha',code:'Sgskj7'},
            {name:'Sweet pioson',code:'Wiudk9'},
            {name:'Luckyman',code:'znj0fh'}
        ]);
        sqliteDb.run(`INSERT OR IGNORE INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?)`,
            ['invitation_codes', invDefault, 'Staff invitation codes list']);
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Invitation codes seeded');
    } catch(e) { console.log('Invitation seed note:', e.message); }

    // Add withdrawal_password column if it doesn't exist (safe migration)
    try {
        sqliteDb.run(`ALTER TABLE users ADD COLUMN withdrawal_password TEXT DEFAULT NULL`);
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Added withdrawal_password column');
    } catch(e) { /* already exists */ }

    // Add transaction_disabled column (safe migration)
    try {
        sqliteDb.run(`ALTER TABLE users ADD COLUMN transaction_disabled INTEGER DEFAULT 0`);
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Added transaction_disabled column');
    } catch(e) { /* already exists */ }

    // Add is_test column (safe migration)
    try {
        sqliteDb.run(`ALTER TABLE users ADD COLUMN is_test INTEGER DEFAULT 0`);
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Added is_test column');
    } catch(e) { /* already exists */ }

    // Add credit_score column (safe migration)
    try {
        sqliteDb.run(`ALTER TABLE users ADD COLUMN credit_score INTEGER DEFAULT 80`);
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Added credit_score column');
    } catch(e) { /* already exists */ }

    // Add invitation_code column (safe migration)
    try {
        sqliteDb.run(`ALTER TABLE users ADD COLUMN invitation_code TEXT DEFAULT NULL`);
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Added invitation_code column');
    } catch(e) { /* already exists */ }

    // Add withdrawal_times column (safe migration) — default 100
    try {
        sqliteDb.run(`ALTER TABLE users ADD COLUMN withdrawal_times INTEGER DEFAULT 100`);
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Added withdrawal_times column');
    } catch(e) { /* already exists */ }

    // Make email optional (remove NOT NULL constraint) — safe migration for SQLite
    try {
        const pragma = sqliteDb.exec("PRAGMA table_info(users)");
        if (pragma.length > 0) {
            const emailCol = pragma[0].values.find(c => c[1] === 'email');
            if (emailCol && emailCol[3] === 1) { // notnull=1 means NOT NULL
                sqliteDb.exec(`
                    BEGIN TRANSACTION;
                    CREATE TABLE users_migrate (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE NOT NULL,
                        email TEXT UNIQUE,
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
                        withdrawal_password TEXT DEFAULT NULL,
                        transaction_disabled INTEGER DEFAULT 0,
                        is_test INTEGER DEFAULT 0,
                        credit_score INTEGER DEFAULT 80,
                        created_at TEXT DEFAULT (datetime('now')),
                        updated_at TEXT DEFAULT (datetime('now'))
                    );
                    INSERT INTO users_migrate SELECT * FROM users;
                    DROP TABLE users;
                    ALTER TABLE users_migrate RENAME TO users;
                    COMMIT;
                `);
                const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
                console.log('✅ Migrated users.email to optional (removed NOT NULL)');
            }
        }
    } catch(e) { console.log('Email optional migration note:', e.message); }

    // Add extra VIP level columns (safe migration)
    const vipMigrations = [
        `ALTER TABLE vip_levels ADD COLUMN task_wheel INTEGER DEFAULT 1`,
        `ALTER TABLE vip_levels ADD COLUMN upgrade_rewards REAL DEFAULT 0`,
        `ALTER TABLE vip_levels ADD COLUMN price_per_grade REAL DEFAULT 0`,
        `ALTER TABLE vip_levels ADD COLUMN min_withdrawal REAL DEFAULT 10`,
        `ALTER TABLE vip_levels ADD COLUMN max_withdrawal REAL DEFAULT 1000`,
        `ALTER TABLE vip_levels ADD COLUMN transaction_fee_rate REAL DEFAULT 0`
    ];
    let vipChanged = false;
    for (const sql of vipMigrations) {
        try { sqliteDb.run(sql); vipChanged = true; } catch(e) { /* already exists */ }
    }
    if (vipChanged) {
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ Added extra VIP level columns');
    }

    // Remove Diamond (level 5) — keep only 4 VIP levels
    try {
        const lvl5 = sqliteDb.exec(`SELECT id FROM vip_levels WHERE level = 5`);
        if (lvl5.length > 0 && lvl5[0].values.length > 0) {
            sqliteDb.run(`DELETE FROM vip_levels WHERE level = 5`);
            const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
            console.log('✅ Removed Diamond (level 5) — now 4 VIP levels');
        }
    } catch(e) { console.log('VIP cleanup note:', e.message); }

    // Create prize_records table (safe migration)
    try {
        sqliteDb.run(`CREATE TABLE IF NOT EXISTS prize_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            prize_name TEXT NOT NULL,
            prize_type TEXT DEFAULT 'USDT',
            amount REAL DEFAULT 0,
            image_url TEXT DEFAULT NULL,
            weight INTEGER DEFAULT 10,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now')),
            reviewed_at TEXT DEFAULT NULL
        )`);
        // Migrate old schema: add missing columns if they don't exist
        try { sqliteDb.run(`ALTER TABLE prize_records ADD COLUMN amount REAL DEFAULT 0`); } catch(e) {}
        try { sqliteDb.run(`ALTER TABLE prize_records ADD COLUMN weight INTEGER DEFAULT 0`); } catch(e) {}
        try { sqliteDb.run(`ALTER TABLE prize_records ADD COLUMN prize_type TEXT DEFAULT 'usdt'`); } catch(e) {}
        try { sqliteDb.run(`ALTER TABLE prize_records ADD COLUMN status TEXT DEFAULT 'pending'`); } catch(e) {}
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ prize_records table ready');
    } catch(e) { console.log('prize_records note:', e.message); }

    // Create spin_prizes table with default prizes
    try {
        sqliteDb.run(`CREATE TABLE IF NOT EXISTS spin_prizes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            prize_type TEXT DEFAULT 'usdt',
            amount REAL DEFAULT 0,
            weight INTEGER DEFAULT 10,
            color TEXT DEFAULT '#8B5CF6',
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        )`);
        // Migrate old schema: add missing columns if they don't exist
        try { sqliteDb.run(`ALTER TABLE spin_prizes ADD COLUMN weight INTEGER DEFAULT 10`); } catch(e) {}
        try { sqliteDb.run(`ALTER TABLE spin_prizes ADD COLUMN prize_type TEXT DEFAULT 'usdt'`); } catch(e) {}
        try { sqliteDb.run(`ALTER TABLE spin_prizes ADD COLUMN amount REAL DEFAULT 0`); } catch(e) {}
        // Fix: prizes with amount=0 must be type 'none' (no reward)
        try { sqliteDb.run(`UPDATE spin_prizes SET prize_type='none' WHERE amount=0 OR amount IS NULL`); } catch(e) {}
        const existingPrizes = sqliteDb.exec(`SELECT COUNT(*) as c FROM spin_prizes`);
        const prizeCount = existingPrizes[0]?.values[0][0] || 0;
        if (prizeCount === 0) {
            const defaultPrizes = [
                ['Better Luck Next Time', 'none', 0, 40, '#9CA3AF'],
                ['Lucky Bonus $5', 'usdt', 5, 25, '#F59E0B'],
                ['Reward $10', 'usdt', 10, 15, '#3B82F6'],
                ['Prize $20', 'usdt', 20, 10, '#10B981'],
                ['Big Prize $50', 'usdt', 50, 7, '#8B5CF6'],
                ['Jackpot $100', 'usdt', 100, 3, '#EF4444'],
            ];
            for (const [name, type, amount, weight, color] of defaultPrizes) {
                sqliteDb.run(
                    `INSERT INTO spin_prizes (name, prize_type, amount, weight, color) VALUES (?, ?, ?, ?, ?)`,
                    [name, type, amount, weight, color]
                );
            }
        }
        const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
        console.log('✅ spin_prizes table ready');
    } catch(e) { console.log('spin_prizes note:', e.message); }

    // ─── Fix product images (replace picsum with Unsplash) ───────────────────
    try {
        const staleCheck = sqliteDb.exec(`SELECT COUNT(*) as c FROM products WHERE image_url LIKE '%picsum.photos%'`);
        const staleCount = staleCheck[0]?.values[0][0] || 0;
        if (staleCount > 0) {
            const imageMap = {
                'iPhone 15 Pro Max':'https://images.unsplash.com/photo-1632661674596-79bd46d16df5?w=400&h=220&fit=crop&auto=format',
                'Samsung Galaxy S24 Ultra':'https://images.unsplash.com/photo-1610945415114-daae5c9d7e83?w=400&h=220&fit=crop&auto=format',
                'MacBook Pro 14"':'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=220&fit=crop&auto=format',
                'Dell XPS 15 Laptop':'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&h=220&fit=crop&auto=format',
                'Sony WH-1000XM5':'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format',
                'iPad Pro 12.9"':'https://images.unsplash.com/photo-1561154464-82e9adf32764?w=400&h=220&fit=crop&auto=format',
                'Apple Watch Ultra 2':'https://images.unsplash.com/photo-1551816230-ef5deaed4a26?w=400&h=220&fit=crop&auto=format',
                'Sony A7R V Camera':'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=220&fit=crop&auto=format',
                'Samsung 65" QLED TV':'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format',
                'Canon EOS R6 Mark II':'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=400&h=220&fit=crop&auto=format',
                'DJI Mini 4 Pro':'https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=400&h=220&fit=crop&auto=format',
                'PlayStation 5':'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=400&h=220&fit=crop&auto=format',
                'Xbox Series X':'https://images.unsplash.com/photo-1621259182978-fbf93132d53d?w=400&h=220&fit=crop&auto=format',
                'Nintendo Switch OLED':'https://images.unsplash.com/photo-1617096200347-cb04ae810b1d?w=400&h=220&fit=crop&auto=format',
                'AirPods Pro 2nd Gen':'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=400&h=220&fit=crop&auto=format',
                'Bose QuietComfort 45':'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format',
                'Samsung Galaxy Watch 6':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'GoPro Hero 12':'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&h=220&fit=crop&auto=format',
                'Kindle Paperwhite':'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=400&h=220&fit=crop&auto=format',
                'Apple TV 4K':'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format',
                'Nike Air Max 270':'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=220&fit=crop&auto=format',
                'Adidas Ultraboost 23':'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=400&h=220&fit=crop&auto=format',
                'Ray-Ban Aviator Classic':'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400&h=220&fit=crop&auto=format',
                "Levi's 501 Original Jeans":'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&h=220&fit=crop&auto=format',
                'Gucci GG Canvas Tote':'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format',
                'Canada Goose Parka':'https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format',
                'Rolex Submariner':'https://images.unsplash.com/photo-1587925358603-c2eea5305bbc?w=400&h=220&fit=crop&auto=format',
                'Louis Vuitton Speedy 25':'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=220&fit=crop&auto=format',
                'Hermès Silk Scarf':'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=400&h=220&fit=crop&auto=format',
                'New Balance 990v6':'https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&h=220&fit=crop&auto=format',
                'Prada Nylon Backpack':'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=220&fit=crop&auto=format',
                'Balenciaga Triple S':'https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=400&h=220&fit=crop&auto=format',
                'Patagonia Better Sweater':'https://images.unsplash.com/photo-1556906781-9a412961a28a?w=400&h=220&fit=crop&auto=format',
                'Ralph Lauren Polo Shirt':'https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&h=220&fit=crop&auto=format',
                'Converse Chuck Taylor All Star':'https://images.unsplash.com/photo-1529810313688-44ea1c2d81d3?w=400&h=220&fit=crop&auto=format',
                'Dyson V15 Detect':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'Instant Pot Duo 7-in-1':'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=220&fit=crop&auto=format',
                'KitchenAid Stand Mixer':'https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=400&h=220&fit=crop&auto=format',
                'Nespresso Vertuo Next':'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=220&fit=crop&auto=format',
                'Vitamix 5200 Blender':'https://images.unsplash.com/photo-1570824104453-508955ab713e?w=400&h=220&fit=crop&auto=format',
                'Philips Hue Starter Kit':'https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?w=400&h=220&fit=crop&auto=format',
                'Roomba j7+ Robot Vacuum':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'Ninja Foodi Air Fryer':'https://images.unsplash.com/photo-1570824104453-508955ab713e?w=400&h=220&fit=crop&auto=format',
                'Casper Wave Hybrid Mattress':'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format',
                'Weber Genesis E-325s Gas Grill':'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&h=220&fit=crop&auto=format',
                'Le Creuset Dutch Oven':'https://images.unsplash.com/photo-1556909144-f66a88e5aec6?w=400&h=220&fit=crop&auto=format',
                'Breville Barista Express':'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=220&fit=crop&auto=format',
                'Nest Learning Thermostat':'https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?w=400&h=220&fit=crop&auto=format',
                'Ring Video Doorbell Pro 2':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'Shark IQ Robot Vacuum':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'Peloton Bike+':'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format',
                'Hydro Flask 32oz':'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&h=220&fit=crop&auto=format',
                'Garmin Fenix 7X Solar':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'Yeti Tundra 45 Cooler':'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=400&h=220&fit=crop&auto=format',
                'Lululemon Align Leggings':'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&h=220&fit=crop&auto=format',
                'Under Armour HOVR Phantom 3':'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=220&fit=crop&auto=format',
                'Bowflex SelectTech 552 Dumbbells':'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=220&fit=crop&auto=format',
                'TRX PRO4 Suspension Trainer':'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=220&fit=crop&auto=format',
                'Manduka PRO Yoga Mat':'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&h=220&fit=crop&auto=format',
                'Trek Marlin 7 Mountain Bike':'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=400&h=220&fit=crop&auto=format',
                'Callaway Rogue ST Driver':'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=220&fit=crop&auto=format',
                'Wilson Pro Staff Tennis Racquet':'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&h=220&fit=crop&auto=format',
                'La Mer Moisturizing Cream':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Dyson Airwrap Complete':'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=400&h=220&fit=crop&auto=format',
                'Charlotte Tilbury Magic Cream':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Olaplex No.3 Hair Perfector':'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=400&h=220&fit=crop&auto=format',
                'FOREO LUNA 4':'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=220&fit=crop&auto=format',
                'SK-II Facial Treatment Essence':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'NuFACE Trinity Facial Toner':'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=220&fit=crop&auto=format',
                'Tatcha The Water Cream':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Drunk Elephant Protini Polypeptide Cream':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Sunday Riley Good Genes':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Cartier Love Bracelet':'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format',
                'Tiffany T Wire Bracelet':'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format',
                'Omega Seamaster 300M':'https://images.unsplash.com/photo-1594534475808-b18fc33b045e?w=400&h=220&fit=crop&auto=format',
                'Pandora Moments Bracelet':'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format',
                'TAG Heuer Carrera':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'Diamond Stud Earrings':'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format',
                'Swarovski Infinity Necklace':'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format',
                'IWC Schaffhausen Pilot Watch':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'The Great Gatsby - F. Scott Fitzgerald':'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format',
                'Atomic Habits - James Clear':'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format',
                'The Psychology of Money':'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format',
                'Dune - Frank Herbert':'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format',
                'The 7 Habits of Highly Effective People':'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format',
                'Michelin Pilot Sport 4S Tires':'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=400&h=220&fit=crop&auto=format',
                'NOCO Genius5 Battery Charger':'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format',
                'Garmin DriveSmart 65 GPS':'https://images.unsplash.com/photo-1547628641-ec4f2a4de5d4?w=400&h=220&fit=crop&auto=format',
                'Thule Pulse M Rooftop Cargo Box':'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format',
                'Chemical Guys Complete Car Care Kit':'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format',
                'LEGO Technic Bugatti Chiron':'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=400&h=220&fit=crop&auto=format',
                'Hasbro Monopoly Classic':'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format',
                'Fisher-Price Little People Farm':'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=400&h=220&fit=crop&auto=format',
                'Nerf Elite 2.0 Commander':'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=400&h=220&fit=crop&auto=format',
                'Hot Wheels Ultimate Garage':'https://images.unsplash.com/photo-1558979158-65a1eaa08691?w=400&h=220&fit=crop&auto=format',
                'Manuka Honey UMF 20+':'https://images.unsplash.com/photo-1587049633312-d628ae50a8ae?w=400&h=220&fit=crop&auto=format',
                'Godiva Chocolatier 24-Piece Box':'https://images.unsplash.com/photo-1549740425-5e9ed4d8cd34?w=400&h=220&fit=crop&auto=format',
                'Illy Espresso Coffee 250g':'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=400&h=220&fit=crop&auto=format',
                'Himalayan Pink Salt Grinder':'https://images.unsplash.com/photo-1604152135912-04a022e23696?w=400&h=220&fit=crop&auto=format',
                'Twinings English Breakfast Tea':'https://images.unsplash.com/photo-1563822249366-3efb23b8e0c9?w=400&h=220&fit=crop&auto=format',
                'Google Pixel 8 Pro':'https://images.unsplash.com/photo-1605236453806-6ff36851218e?w=400&h=220&fit=crop&auto=format',
                'OnePlus 12':'https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=400&h=220&fit=crop&auto=format',
                'Microsoft Surface Pro 10':'https://images.unsplash.com/photo-1587614382346-4ec70e388b28?w=400&h=220&fit=crop&auto=format',
                'Lenovo ThinkPad X1 Carbon':'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=400&h=220&fit=crop&auto=format',
                'ASUS ROG Strix Gaming Monitor':'https://images.unsplash.com/photo-1527443224154-c4a573d5f5ac?w=400&h=220&fit=crop&auto=format',
                'Logitech MX Master 3S':'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=400&h=220&fit=crop&auto=format',
                'Corsair K100 RGB Keyboard':'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&h=220&fit=crop&auto=format',
                'Samsung T9 Portable SSD':'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=220&fit=crop&auto=format',
                'WD Black SN850X NVMe SSD':'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=220&fit=crop&auto=format',
                'NVIDIA GeForce RTX 4080 Super':'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=400&h=220&fit=crop&auto=format',
                'Jordan 1 Retro High OG':'https://images.unsplash.com/photo-1556906781-9a412961a28a?w=400&h=220&fit=crop&auto=format',
                'Yeezy Boost 350 V2':'https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=400&h=220&fit=crop&auto=format',
                'Dior Oblique Saddle Bag':'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format',
                'Burberry Cashmere Scarf':'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=400&h=220&fit=crop&auto=format',
                'Moncler Grenoble Down Jacket':'https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format',
                'Valentino Garavani Rockstud Pumps':'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&h=220&fit=crop&auto=format',
                'Saint Laurent Kate Belt Bag':'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format',
                'Acne Studios Wool Blend Coat':'https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format',
                'Bottega Veneta Jodie Bag':'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format',
                'Stone Island Crewneck Sweatshirt':'https://images.unsplash.com/photo-1556906781-9a412961a28a?w=400&h=220&fit=crop&auto=format',
                'Traeger Pro 780 Pellet Grill':'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&h=220&fit=crop&auto=format',
                'Cuisinart 12-Piece Stainless Cookware':'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=220&fit=crop&auto=format',
                'Nespresso Lattissima One':'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=220&fit=crop&auto=format',
                'Breville Smart Oven Air Fryer Pro':'https://images.unsplash.com/photo-1570824104453-508955ab713e?w=400&h=220&fit=crop&auto=format',
                'All-Clad D3 Stainless 10-Piece':'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=220&fit=crop&auto=format',
                'Saatva Classic Mattress':'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format',
                'TEMPUR-Adapt Medium Pillow':'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format',
                'Purple Mattress Hybrid Premier':'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format',
                'Dyson Pure Cool Air Purifier':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'LG InstaView French Door Refrigerator':'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=400&h=220&fit=crop&auto=format',
                'Apple Fitness+ Annual Plan':'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format',
                'NordicTrack Commercial 1750 Treadmill':'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format',
                'Schwinn IC4 Indoor Cycling Bike':'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format',
                'Rogue Monster Squat Stand':'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=220&fit=crop&auto=format',
                'Theragun Pro 5th Gen':'https://images.unsplash.com/photo-1611073615830-9d2b2f8b68d4?w=400&h=220&fit=crop&auto=format',
                'WHOOP 4.0 Wristband':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'Osprey Atmos AG 65 Backpack':'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&h=220&fit=crop&auto=format',
                'Black Diamond Spot 400 Headlamp':'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&h=220&fit=crop&auto=format',
                'MSR WhisperLite Universal Stove':'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&h=220&fit=crop&auto=format',
                'Nalgene Wide Mouth 32oz':'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&h=220&fit=crop&auto=format',
                'Estée Lauder Advanced Night Repair':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'La Prairie White Caviar Illuminating Cream':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'SkinCeuticals C E Ferulic':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Augustinus Bader The Rich Cream':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Lancôme Génifique Advanced Youth Activating Concentrate':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Sisley Black Rose Precious Face Oil':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                "Kiehl's Ultra Facial Cream SPF 30":'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Sulwhasoo Snowise Brightening Serum':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'PIXI Glow Tonic':'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format',
                'Mario Badescu Facial Spray':'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=400&h=220&fit=crop&auto=format',
                'Van Cleef & Arpels Alhambra Necklace':'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format',
                'Bulgari Serpenti Bracelet':'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format',
                'Chopard Happy Diamonds Earrings':'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format',
                'Mejuri Bold Chain Necklace':'https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format',
                'Monica Vinader Fiji Ring':'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format',
                'Audemars Piguet Royal Oak':'https://images.unsplash.com/photo-1587925358603-c2eea5305bbc?w=400&h=220&fit=crop&auto=format',
                'Patek Philippe Nautilus':'https://images.unsplash.com/photo-1587925358603-c2eea5305bbc?w=400&h=220&fit=crop&auto=format',
                'Garmin Epix Pro Solar':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'Suunto Race S':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'Polar Vantage V3':'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format',
                'Build and Become Brain Training Cards':'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format',
                'Ravensburger 5000-Piece Puzzle':'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format',
                'Settlers of Catan':'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format',
                'UNO Card Game':'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format',
                'Mecanum Wheel Robot Car Kit':'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=400&h=220&fit=crop&auto=format',
                'Veuve Clicquot Brut Champagne':'https://images.unsplash.com/photo-1557435453-de52cb7b18c2?w=400&h=220&fit=crop&auto=format',
                'Beluga Noble Vodka':'https://images.unsplash.com/photo-1557435453-de52cb7b18c2?w=400&h=220&fit=crop&auto=format',
                "Whittaker's Dark Chocolate Box":'https://images.unsplash.com/photo-1549740425-5e9ed4d8cd34?w=400&h=220&fit=crop&auto=format',
                'Juan Valdez Premium Coffee Beans':'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=400&h=220&fit=crop&auto=format',
                'Himalayan Chef Pink Salt 10lb':'https://images.unsplash.com/photo-1604152135912-04a022e23696?w=400&h=220&fit=crop&auto=format',
                'Tesla Model 3 Floor Mats':'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format',
                "Meguiar's Ultimate Polish":'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format',
                'Blackvue DR970X-2CH Dashcam':'https://images.unsplash.com/photo-1547628641-ec4f2a4de5d4?w=400&h=220&fit=crop&auto=format',
                'Covercraft Custom Car Cover':'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format',
                'K&N High-Flow Air Filter':'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format',
                'Samsung The Frame 55" TV':'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format',
                'LG C3 OLED 65" TV':'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format',
                'Sonos Arc Soundbar':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'Bose Smart Soundbar 900':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'KEF LS50 Meta Bookshelf Speakers':'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format',
                'Alo Yoga High-Waist Leggings':'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&h=220&fit=crop&auto=format',
                "Arc'teryx Beta AR Jacket":'https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format',
                'Salomon X Ultra 4 GTX Hiking Boots':'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=220&fit=crop&auto=format',
                'The North Face Summit Series Fleece':'https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format',
                'Filson Mackinaw Cruiser Jacket':'https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format',
                'Montblanc Meisterstück Rollerball':'https://images.unsplash.com/photo-1585336261022-680e295ce3fe?w=400&h=220&fit=crop&auto=format',
                'Smythson Panama Notebook':'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format',
                'Leuchtturm1917 Bullet Journal':'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format',
                'Pokémon TCG: Scarlet & Violet Booster Box':'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format',
                'Magic: The Gathering Bundle Set':'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format',
                'Dyson Zone Air Purifying Headphones':'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format',
                'Bang & Olufsen Beoplay H95':'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format',
                'Jabra Evolve2 85 Headset':'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format',
                'Anker 733 Power Bank':'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&h=220&fit=crop&auto=format',
                'Belkin BoostCharge Pro MagSafe Stand':'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&h=220&fit=crop&auto=format',
                'Fender Player Stratocaster':'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=220&fit=crop&auto=format',
                'Gibson Les Paul Standard':'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=220&fit=crop&auto=format',
                'Roland FP-90X Digital Piano':'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=400&h=220&fit=crop&auto=format',
                'Bose SoundLink Max Portable Speaker':'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400&h=220&fit=crop&auto=format',
                'Harman Kardon Onyx Studio 8':'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400&h=220&fit=crop&auto=format',
            };
            let imgFixed = 0;
            for (const [name, url] of Object.entries(imageMap)) {
                sqliteDb.run('UPDATE products SET image_url = ? WHERE name = ? AND image_url LIKE ?', [url, name, '%picsum.photos%']);
                imgFixed++;
            }
            const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
            console.log(`✅ Fixed product images for ${imgFixed} products`);
        }
    } catch(e) { console.log('Product image fix note:', e.message); }

    // ─── Seed Products (up to 200) ────────────────────────────────────────────
    try {
        const existing = sqliteDb.exec(`SELECT COUNT(*) as c FROM products WHERE status='active'`);
        const productCount = existing[0]?.values[0][0] || 0;
        if (productCount < 200) {
            const seedProducts = [
                // Electronics
                ['iPhone 15 Pro Max','Apple flagship smartphone with A17 Pro chip, titanium frame and 48MP camera system.',1199,'Electronics','https://images.unsplash.com/photo-1632661674596-79bd46d16df5?w=400&h=220&fit=crop&auto=format'],
                ['Samsung Galaxy S24 Ultra','Android powerhouse with 200MP camera, S Pen stylus and 5000mAh battery.',1099,'Electronics','https://images.unsplash.com/photo-1610945415114-daae5c9d7e83?w=400&h=220&fit=crop&auto=format'],
                ['MacBook Pro 14"','Apple M3 Pro chip, Liquid Retina XDR display, 18-hour battery life.',1999,'Electronics','https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&h=220&fit=crop&auto=format'],
                ['Dell XPS 15 Laptop','15.6" OLED display, Intel Core i9, 32GB RAM, 1TB SSD.',1799,'Electronics','https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&h=220&fit=crop&auto=format'],
                ['Sony WH-1000XM5','Industry-leading noise cancelling headphones with 30-hour battery.',349,'Electronics','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format'],
                ['iPad Pro 12.9"','M2 chip, Liquid Retina XDR display, USB-C with Thunderbolt.',1099,'Electronics','https://images.unsplash.com/photo-1561154464-82e9adf32764?w=400&h=220&fit=crop&auto=format'],
                ['Apple Watch Ultra 2','Rugged titanium smartwatch with precision dual-frequency GPS.',799,'Electronics','https://images.unsplash.com/photo-1551816230-ef5deaed4a26?w=400&h=220&fit=crop&auto=format'],
                ['Sony A7R V Camera','61MP full-frame mirrorless camera with AI-powered autofocus.',3899,'Electronics','https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=220&fit=crop&auto=format'],
                ['Samsung 65" QLED TV','4K QLED Smart TV with Quantum HDR and 120Hz refresh rate.',1499,'Electronics','https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format'],
                ['Canon EOS R6 Mark II','Full-frame mirrorless camera with 40fps burst shooting.',2499,'Electronics','https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=400&h=220&fit=crop&auto=format'],
                ['DJI Mini 4 Pro','Compact foldable drone with 4K/60fps video and obstacle sensing.',759,'Electronics','https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=400&h=220&fit=crop&auto=format'],
                ['PlayStation 5','Next-gen gaming console with ultra-high speed SSD and DualSense controller.',499,'Electronics','https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=400&h=220&fit=crop&auto=format'],
                ['Xbox Series X','4K gaming at 60fps, 12 teraflops of processing power.',499,'Electronics','https://images.unsplash.com/photo-1621259182978-fbf93132d53d?w=400&h=220&fit=crop&auto=format'],
                ['Nintendo Switch OLED','Vibrant 7-inch OLED screen, enhanced audio, 64GB storage.',349,'Electronics','https://images.unsplash.com/photo-1617096200347-cb04ae810b1d?w=400&h=220&fit=crop&auto=format'],
                ['AirPods Pro 2nd Gen','Active noise cancellation, Adaptive Audio, and MagSafe charging.',249,'Electronics','https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=400&h=220&fit=crop&auto=format'],
                ['Bose QuietComfort 45','World-class noise cancelling wireless headphones.',329,'Electronics','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format'],
                ['Samsung Galaxy Watch 6','Advanced health monitoring with BioActive Sensor and sapphire glass.',299,'Electronics','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                ['GoPro Hero 12','5.3K60 video, HyperSmooth 6.0, waterproof to 10m.',399,'Electronics','https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&h=220&fit=crop&auto=format'],
                ['Kindle Paperwhite','6.8" display, adjustable warm light, waterproof, 10-week battery.',139,'Electronics','https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=400&h=220&fit=crop&auto=format'],
                ['Apple TV 4K','Cinematic mode, spatial audio, and the power of A15 Bionic.',129,'Electronics','https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format'],
                // Fashion & Clothing
                ['Nike Air Max 270','Lightweight upper, Max Air heel unit for all-day comfort.',150,'Fashion','https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=220&fit=crop&auto=format'],
                ['Adidas Ultraboost 23','Responsive Boost midsole, Primeknit upper, Continental rubber.',190,'Fashion','https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=400&h=220&fit=crop&auto=format'],
                ['Ray-Ban Aviator Classic','Iconic polarized sunglasses with gold metal frame.',173,'Fashion','https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400&h=220&fit=crop&auto=format'],
                ["Levi's 501 Original Jeans",'Classic straight fit denim jeans, button fly, 100% cotton.',69,'Fashion','https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&h=220&fit=crop&auto=format'],
                ['Gucci GG Canvas Tote','Luxury canvas tote bag with iconic GG print and leather trim.',950,'Fashion','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format'],
                ['Canada Goose Parka','Premium expedition parka with Arctic Tech shell, fur-trimmed hood.',895,'Fashion','https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format'],
                ['Rolex Submariner','Iconic dive watch, 300m waterproof, Cerachrom bezel, Oyster bracelet.',9150,'Jewelry','https://images.unsplash.com/photo-1587925358603-c2eea5305bbc?w=400&h=220&fit=crop&auto=format'],
                ['Louis Vuitton Speedy 25','Classic monogram canvas handbag with leather trim and padlock.',1050,'Fashion','https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&h=220&fit=crop&auto=format'],
                ['Hermès Silk Scarf','100% silk twill scarf, hand-rolled edges, iconic print.',450,'Fashion','https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=400&h=220&fit=crop&auto=format'],
                ['New Balance 990v6','Made in USA, premium suede and mesh upper, ENCAP midsole.',185,'Fashion','https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&h=220&fit=crop&auto=format'],
                ['Prada Nylon Backpack','Re-Nylon backpack with Saffiano leather trims and adjustable straps.',1150,'Fashion','https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=220&fit=crop&auto=format'],
                ['Balenciaga Triple S','Chunky layered-sole sneakers in mesh and leather.',895,'Fashion','https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=400&h=220&fit=crop&auto=format'],
                ['Patagonia Better Sweater','Fleece jacket with recycled polyester, full-zip, classic fit.',139,'Fashion','https://images.unsplash.com/photo-1556906781-9a412961a28a?w=400&h=220&fit=crop&auto=format'],
                ['Ralph Lauren Polo Shirt','Classic cotton piqué polo with embroidered Polo Pony.',89,'Fashion','https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&h=220&fit=crop&auto=format'],
                ['Converse Chuck Taylor All Star','Classic hi-top canvas sneaker with signature rubber sole.',60,'Fashion','https://images.unsplash.com/photo-1529810313688-44ea1c2d81d3?w=400&h=220&fit=crop&auto=format'],
                // Home & Kitchen
                ['Dyson V15 Detect','Laser dust detection, 60 min runtime, HEPA filtration.',749,'Home','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                ['Instant Pot Duo 7-in-1','Pressure cooker, slow cooker, rice cooker, steamer, sauté, yogurt maker.',99,'Kitchen','https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=220&fit=crop&auto=format'],
                ['KitchenAid Stand Mixer','5-quart tilt-head stand mixer with 10 speeds, 59 attachments available.',449,'Kitchen','https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=400&h=220&fit=crop&auto=format'],
                ['Nespresso Vertuo Next','Coffee and espresso machine with centrifusion technology.',179,'Kitchen','https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=220&fit=crop&auto=format'],
                ['Vitamix 5200 Blender','Variable speed control, self-cleaning, aircraft-grade stainless steel.',449,'Kitchen','https://images.unsplash.com/photo-1570824104453-508955ab713e?w=400&h=220&fit=crop&auto=format'],
                ['Philips Hue Starter Kit','Smart LED bulbs with bridge, 16 million colors, voice control.',129,'Home','https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?w=400&h=220&fit=crop&auto=format'],
                ['Roomba j7+ Robot Vacuum','Self-emptying, obstacle avoidance, smart mapping, Alexa compatible.',599,'Home','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                ['Ninja Foodi Air Fryer','6-in-1 DualZone air fryer, 8-quart capacity, 6 cooking functions.',199,'Kitchen','https://images.unsplash.com/photo-1570824104453-508955ab713e?w=400&h=220&fit=crop&auto=format'],
                ['Casper Wave Hybrid Mattress','Zoned ergonomic support, 7 layers including gel pods.',2995,'Bedroom','https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format'],
                ['Weber Genesis E-325s Gas Grill','3 burners, sear station, iGrill3 compatible, 10-year warranty.',999,'Outdoor','https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&h=220&fit=crop&auto=format'],
                ['Le Creuset Dutch Oven','Enameled cast iron, 5.5-quart, chip and crack resistant enamel.',399,'Kitchen','https://images.unsplash.com/photo-1556909144-f66a88e5aec6?w=400&h=220&fit=crop&auto=format'],
                ['Breville Barista Express','Built-in conical burr grinder, 15-bar pump, steam wand.',699,'Kitchen','https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=220&fit=crop&auto=format'],
                ['Nest Learning Thermostat','Auto-schedule, energy-saving, remote control, compatible with Alexa.',249,'Home','https://images.unsplash.com/photo-1565814329452-e1efa11c5b89?w=400&h=220&fit=crop&auto=format'],
                ['Ring Video Doorbell Pro 2','1536p HD, 3D motion detection, bird\'s eye view, two-way talk.',249,'Home','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                ['Shark IQ Robot Vacuum','Self-empty base, home mapping, WiFi, voice control.',499,'Home','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                // Sports & Fitness
                ['Peloton Bike+','22" rotating HD touchscreen, auto-resistance, live and on-demand classes.',2495,'Sports','https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format'],
                ['Hydro Flask 32oz','Double-wall vacuum insulation, TempShield, BPA-free stainless steel.',44,'Sports','https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&h=220&fit=crop&auto=format'],
                ['Garmin Fenix 7X Solar','Multisport GPS watch, solar charging, 37-day battery, titanium.',899,'Sports','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                ['Yeti Tundra 45 Cooler','Rotomolded construction, PermaFrost insulation, bearproof certified.',325,'Outdoor','https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=400&h=220&fit=crop&auto=format'],
                ['Lululemon Align Leggings','Buttery-soft Nulu fabric, 28" inseam, four-way stretch.',98,'Sports','https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&h=220&fit=crop&auto=format'],
                ['Under Armour HOVR Phantom 3','Connected running shoe with MapMyRun app integration.',130,'Sports','https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=220&fit=crop&auto=format'],
                ['Bowflex SelectTech 552 Dumbbells','Adjustable 5-52.5 lbs, 15 weight settings, replaces 15 sets.',429,'Sports','https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=220&fit=crop&auto=format'],
                ['TRX PRO4 Suspension Trainer','Military-grade, 6 anchor points, full-body workout anywhere.',249,'Sports','https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=220&fit=crop&auto=format'],
                ['Manduka PRO Yoga Mat','6mm thick, non-toxic PVC, lifetime guarantee, 71" length.',120,'Sports','https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&h=220&fit=crop&auto=format'],
                ['Trek Marlin 7 Mountain Bike','Aluminum frame, RockShox 30 Silver fork, Shimano hydraulic disc brakes.',849,'Sports','https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=400&h=220&fit=crop&auto=format'],
                ['Callaway Rogue ST Driver','Jailbreak AI Speed Frame, Triaxial Carbon Crown, 460cc head.',499,'Sports','https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=220&fit=crop&auto=format'],
                ['Wilson Pro Staff Tennis Racquet','97 sq in head, 11.2oz, 16x19 string pattern.',229,'Sports','https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&h=220&fit=crop&auto=format'],
                // Beauty & Personal Care
                ['La Mer Moisturizing Cream','Miracle Broth formula, 60ml, restores skin with sea kelp.',340,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Dyson Airwrap Complete','Multi-styler with Coanda effect, 6 attachments, auto air direction.',599,'Beauty','https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=400&h=220&fit=crop&auto=format'],
                ['Charlotte Tilbury Magic Cream','Moisturiser with hyaluronic acid, rose hip, and vitamin C complex.',105,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Olaplex No.3 Hair Perfector','At-home treatment to strengthen hair and reduce breakage.',28,'Beauty','https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=400&h=220&fit=crop&auto=format'],
                ['FOREO LUNA 4','T-Sonic facial cleansing device, 16 intensities, app connected.',199,'Beauty','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=220&fit=crop&auto=format'],
                ['SK-II Facial Treatment Essence','Pitera formula, improves skin clarity and texture, 230ml.',185,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['NuFACE Trinity Facial Toner','FDA-cleared microcurrent device with interchangeable attachments.',339,'Beauty','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=220&fit=crop&auto=format'],
                ['Tatcha The Water Cream','Oil-free pore-minimizing moisturizer with Japanese lilly extract.',68,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Drunk Elephant Protini Polypeptide Cream','Signal peptide complex, amino acid blend, moisturizing formula.',68,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Sunday Riley Good Genes','Lactic acid treatment, clarifying serum, brightens complexion.',85,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                // Jewelry & Watches
                ['Cartier Love Bracelet','18K yellow gold, 6 diamonds, screwdriver clasp, 6.1mm wide.',6900,'Jewelry','https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format'],
                ['Tiffany T Wire Bracelet','Sterling silver open wire bracelet, medium size.',375,'Jewelry','https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format'],
                ['Omega Seamaster 300M','Co-Axial Master Chronometer, ceramic bezel, bracelet strap.',5900,'Jewelry','https://images.unsplash.com/photo-1594534475808-b18fc33b045e?w=400&h=220&fit=crop&auto=format'],
                ['Pandora Moments Bracelet','Sterling silver snake chain with barrel clasp, 19cm.',65,'Jewelry','https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format'],
                ['TAG Heuer Carrera','Calibre 5 automatic, 39mm case, sapphire crystal, date display.',1650,'Jewelry','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                ['Diamond Stud Earrings','0.5 carat total weight, GIA certified, set in 14K white gold.',999,'Jewelry','https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format'],
                ['Swarovski Infinity Necklace','Rhodium-plated necklace with infinity pendant, clear crystals.',89,'Jewelry','https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format'],
                ['IWC Schaffhausen Pilot Watch','Automatic, 41mm, anti-reflective sapphire crystal, leather strap.',4800,'Jewelry','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                // Books & Media
                ['The Great Gatsby - F. Scott Fitzgerald','Classic novel set in the Roaring Twenties. Scribner edition.',15,'Books','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format'],
                ['Atomic Habits - James Clear','Proven framework for getting 1% better every day.',27,'Books','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format'],
                ['The Psychology of Money','Timeless lessons on wealth, greed, and happiness.',19,'Books','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format'],
                ['Dune - Frank Herbert','Classic sci-fi epic, Hugo and Nebula Award winner.',18,'Books','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format'],
                ['The 7 Habits of Highly Effective People','Powerful lessons in personal change by Stephen Covey.',17,'Books','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format'],
                // Automotive
                ['Michelin Pilot Sport 4S Tires','Ultra-high performance summer tire, 245/40R18, set of 4.',899,'Automotive','https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=400&h=220&fit=crop&auto=format'],
                ['NOCO Genius5 Battery Charger','5-amp smart charger for 6V/12V lead-acid batteries.',69,'Automotive','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format'],
                ['Garmin DriveSmart 65 GPS','6.95" display, driver alerts, live traffic, hands-free calling.',199,'Automotive','https://images.unsplash.com/photo-1547628641-ec4f2a4de5d4?w=400&h=220&fit=crop&auto=format'],
                ['Thule Pulse M Rooftop Cargo Box','12 cubic feet, fits most cars, aerodynamic design.',599,'Automotive','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format'],
                ['Chemical Guys Complete Car Care Kit','Detailing kit with 16 products, buffer, and pads.',149,'Automotive','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format'],
                // Toys & Games
                ['LEGO Technic Bugatti Chiron','3599 pieces, 1:8 scale, working engine and gearbox.',449,'Toys','https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=400&h=220&fit=crop&auto=format'],
                ['Hasbro Monopoly Classic','Classic board game for 2-6 players, includes tokens and dice.',22,'Toys','https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format'],
                ['Fisher-Price Little People Farm','Realistic farm sounds, 12 pieces, suitable for ages 1-5.',34,'Toys','https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=400&h=220&fit=crop&auto=format'],
                ['Nerf Elite 2.0 Commander','20-dart revolving drum, pull-back priming, fires 27m.',40,'Toys','https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=400&h=220&fit=crop&auto=format'],
                ['Hot Wheels Ultimate Garage','5-lane spiral, 2 elevators, 140+ car storage.',99,'Toys','https://images.unsplash.com/photo-1558979158-65a1eaa08691?w=400&h=220&fit=crop&auto=format'],
                // Food & Grocery
                ['Manuka Honey UMF 20+','Premium New Zealand Manuka honey, 250g jar.',79,'Food','https://images.unsplash.com/photo-1587049633312-d628ae50a8ae?w=400&h=220&fit=crop&auto=format'],
                ['Godiva Chocolatier 24-Piece Box','Assorted Belgian chocolates, milk and dark varieties.',55,'Food','https://images.unsplash.com/photo-1549740425-5e9ed4d8cd34?w=400&h=220&fit=crop&auto=format'],
                ['Illy Espresso Coffee 250g','100% Arabica fine ground espresso, classic medium roast.',19,'Food','https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=400&h=220&fit=crop&auto=format'],
                ['Himalayan Pink Salt Grinder','Coarse grain, mineral-rich, food-grade glass grinder.',12,'Food','https://images.unsplash.com/photo-1604152135912-04a022e23696?w=400&h=220&fit=crop&auto=format'],
                ['Twinings English Breakfast Tea','80 tea bags, classic full-bodied black tea blend.',8,'Food','https://images.unsplash.com/photo-1563822249366-3efb23b8e0c9?w=400&h=220&fit=crop&auto=format'],
                // Additional products 101-200
                ['Google Pixel 8 Pro','6.7" LTPO OLED, Tensor G3 chip, 50MP camera, 7 years of updates.',999,'Electronics','https://images.unsplash.com/photo-1605236453806-6ff36851218e?w=400&h=220&fit=crop&auto=format'],
                ['OnePlus 12','6.82" AMOLED 120Hz, Snapdragon 8 Gen 3, 100W charging.',799,'Electronics','https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=400&h=220&fit=crop&auto=format'],
                ['Microsoft Surface Pro 10','13" PixelSense Flow display, Intel Core Ultra, Copilot+ PC.',1599,'Electronics','https://images.unsplash.com/photo-1587614382346-4ec70e388b28?w=400&h=220&fit=crop&auto=format'],
                ['Lenovo ThinkPad X1 Carbon','14" 2.8K OLED, Intel Core i7 vPro, 57Wh battery, MIL-SPEC.',1899,'Electronics','https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=400&h=220&fit=crop&auto=format'],
                ['ASUS ROG Strix Gaming Monitor','27" QHD 165Hz IPS, G-Sync Compatible, 1ms GTG, HDR400.',499,'Electronics','https://images.unsplash.com/photo-1527443224154-c4a573d5f5ac?w=400&h=220&fit=crop&auto=format'],
                ['Logitech MX Master 3S','8K DPI sensor, MagSpeed scroll wheel, USB-C, Bluetooth.',99,'Electronics','https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=400&h=220&fit=crop&auto=format'],
                ['Corsair K100 RGB Keyboard','Optical-mechanical switches, per-key RGB, iCUE software.',229,'Electronics','https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&h=220&fit=crop&auto=format'],
                ['Samsung T9 Portable SSD','4TB, USB 3.2 Gen 2x2, 2000MB/s, military-grade shock resistance.',349,'Electronics','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=220&fit=crop&auto=format'],
                ['WD Black SN850X NVMe SSD','2TB, PCIe 4.0, 7300MB/s read, heatsink edition.',199,'Electronics','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=220&fit=crop&auto=format'],
                ['NVIDIA GeForce RTX 4080 Super','16GB GDDR6X, DLSS 3, ray tracing, 4K gaming performance.',999,'Electronics','https://images.unsplash.com/photo-1591488320449-011701bb6704?w=400&h=220&fit=crop&auto=format'],
                ['Jordan 1 Retro High OG','Chicago colorway, tumbled leather upper, Air cushioning.',180,'Fashion','https://images.unsplash.com/photo-1556906781-9a412961a28a?w=400&h=220&fit=crop&auto=format'],
                ['Yeezy Boost 350 V2','Primeknit upper, BOOST midsole, Adidas Originals collab.',220,'Fashion','https://images.unsplash.com/photo-1600185365926-3a2ce3cdb9eb?w=400&h=220&fit=crop&auto=format'],
                ['Dior Oblique Saddle Bag','Dior Oblique jacquard canvas, grained calfskin trim.',2900,'Fashion','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format'],
                ['Burberry Cashmere Scarf','Giant check pattern, 100% cashmere, fringe edge.',450,'Fashion','https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=400&h=220&fit=crop&auto=format'],
                ['Moncler Grenoble Down Jacket','700-fill goose down, water-repellent, stretch woven fabric.',895,'Fashion','https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format'],
                ['Valentino Garavani Rockstud Pumps','105mm heel, leather upper, signature pyramid studs.',995,'Fashion','https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&h=220&fit=crop&auto=format'],
                ['Saint Laurent Kate Belt Bag','Grain de poudre embossed leather, YSL clasp, adjustable strap.',1150,'Fashion','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format'],
                ['Acne Studios Wool Blend Coat','Oversized silhouette, dropped shoulders, single button.',1100,'Fashion','https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format'],
                ['Bottega Veneta Jodie Bag','Woven intrecciato leather, knotted handle, minimalist design.',2100,'Fashion','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&h=220&fit=crop&auto=format'],
                ['Stone Island Crewneck Sweatshirt','Fleece cotton, iconic compass patch, garment dyed.',295,'Fashion','https://images.unsplash.com/photo-1556906781-9a412961a28a?w=400&h=220&fit=crop&auto=format'],
                ['Traeger Pro 780 Pellet Grill','WiFIRE technology, 780 sq in cooking area, Super Smoke mode.',899,'Outdoor','https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&h=220&fit=crop&auto=format'],
                ['Cuisinart 12-Piece Stainless Cookware','Tri-ply construction, dishwasher safe, oven safe to 550°F.',299,'Kitchen','https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=220&fit=crop&auto=format'],
                ['Nespresso Lattissima One','Automatic frothed milk, 5 beverage sizes, compact design.',299,'Kitchen','https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=220&fit=crop&auto=format'],
                ['Breville Smart Oven Air Fryer Pro','13-in-1 countertop oven, 1800W, Super Convection technology.',399,'Kitchen','https://images.unsplash.com/photo-1570824104453-508955ab713e?w=400&h=220&fit=crop&auto=format'],
                ['All-Clad D3 Stainless 10-Piece','Tri-ply bonded cookware, oven safe to 600°F, induction compatible.',599,'Kitchen','https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=220&fit=crop&auto=format'],
                ['Saatva Classic Mattress','Luxury innerspring, Euro pillow top, 365-day return policy.',1795,'Bedroom','https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format'],
                ['TEMPUR-Adapt Medium Pillow','TEMPUR material, ergonomic shape, removable cover.',169,'Bedroom','https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format'],
                ['Purple Mattress Hybrid Premier','Purple Grid technology, responsive coils, cooling cover.',2299,'Bedroom','https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&h=220&fit=crop&auto=format'],
                ['Dyson Pure Cool Air Purifier','HEPA + activated carbon filter, 350° oscillation, app control.',549,'Home','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                ['LG InstaView French Door Refrigerator','27 cu ft, InstaView door-in-door, Craft Ice maker.',2799,'Home','https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=400&h=220&fit=crop&auto=format'],
                ['Apple Fitness+ Annual Plan','Annual subscription for guided workouts, yoga, meditation.',79,'Fitness','https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format'],
                ['NordicTrack Commercial 1750 Treadmill','14" smart HD touchscreen, iFIT, 10% incline and -3% decline.',1799,'Sports','https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format'],
                ['Schwinn IC4 Indoor Cycling Bike','100 magnetic resistance levels, Bluetooth, 40 lb flywheel.',899,'Sports','https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=400&h=220&fit=crop&auto=format'],
                ['Rogue Monster Squat Stand','11-gauge steel, 1000 lb capacity, westside hole spacing.',895,'Sports','https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=220&fit=crop&auto=format'],
                ['Theragun Pro 5th Gen','Proprietary brushless motor, 60-min battery, Bluetooth app.',399,'Sports','https://images.unsplash.com/photo-1611073615830-9d2b2f8b68d4?w=400&h=220&fit=crop&auto=format'],
                ['WHOOP 4.0 Wristband','Continuous health monitoring, strain coaching, recovery score.',239,'Sports','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                ['Osprey Atmos AG 65 Backpack','Anti-Gravity suspension, 65L, raincover included, hipbelt pockets.',270,'Outdoor','https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&h=220&fit=crop&auto=format'],
                ['Black Diamond Spot 400 Headlamp','400 lumens, IPX8 waterproof, red night vision mode.',45,'Outdoor','https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&h=220&fit=crop&auto=format'],
                ['MSR WhisperLite Universal Stove','Multi-fuel, 9000 BTU, compatible with MSR fuel bottles.',119,'Outdoor','https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&h=220&fit=crop&auto=format'],
                ['Nalgene Wide Mouth 32oz','BPA-free Tritan plastic, loop-top lid, dishwasher safe.',15,'Outdoor','https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&h=220&fit=crop&auto=format'],
                ['Estée Lauder Advanced Night Repair','Serum synchronized recovery complex II, 50ml.',115,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['La Prairie White Caviar Illuminating Cream','Caviar Extract, advanced brightening complex, 60ml.',895,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['SkinCeuticals C E Ferulic','Vitamin C antioxidant treatment serum, 1 fl oz.',182,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Augustinus Bader The Rich Cream','TFC8 complex, luxurious moisturizer, 50ml.',265,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Lancôme Génifique Advanced Youth Activating Concentrate','Pro-xylane, bifidus prebiotic, 50ml serum.',115,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Sisley Black Rose Precious Face Oil','8 precious oils with Black Rose extract, 25ml.',285,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Kiehl\'s Ultra Facial Cream SPF 30','24-hour hydration, broad spectrum SPF 30, 50ml.',39,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Sulwhasoo Snowise Brightening Serum','Mulberry root extract, brightening complex, 30ml.',125,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['PIXI Glow Tonic','Aloe vera, ginseng, glycolic acid toner, 250ml.',29,'Beauty','https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=220&fit=crop&auto=format'],
                ['Mario Badescu Facial Spray','Rose water, herbs, and rosewater refreshing mist, 118ml.',9,'Beauty','https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=400&h=220&fit=crop&auto=format'],
                ['Van Cleef & Arpels Alhambra Necklace','18K yellow gold, malachite clover motif pendant.',4350,'Jewelry','https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format'],
                ['Bulgari Serpenti Bracelet','18K rose gold, pavé diamonds, serpent head clasp.',18500,'Jewelry','https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format'],
                ['Chopard Happy Diamonds Earrings','18K white gold, floating diamonds, floral motif.',4500,'Jewelry','https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format'],
                ['Mejuri Bold Chain Necklace','14K yellow gold-filled, adjustable 16"-18", lobster clasp.',165,'Jewelry','https://images.unsplash.com/photo-1611085583191-a3b181a88401?w=400&h=220&fit=crop&auto=format'],
                ['Monica Vinader Fiji Ring','18K rose gold vermeil, hammered texture, stackable.',95,'Jewelry','https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&h=220&fit=crop&auto=format'],
                ['Audemars Piguet Royal Oak','37mm, 18K pink gold, self-winding, "tapisserie" dial.',35000,'Jewelry','https://images.unsplash.com/photo-1587925358603-c2eea5305bbc?w=400&h=220&fit=crop&auto=format'],
                ['Patek Philippe Nautilus','40mm, stainless steel, blue horizontal embossed dial.',34000,'Jewelry','https://images.unsplash.com/photo-1587925358603-c2eea5305bbc?w=400&h=220&fit=crop&auto=format'],
                ['Garmin Epix Pro Solar','Sapphire glass, titanium bezel, solar charging, 89-day battery.',1299,'Sports','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                ['Suunto Race S','49mm titanium, AMOLED 1.43" display, 40-day battery.',599,'Sports','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                ['Polar Vantage V3','AMOLED 1.39" display, dual-frequency GPS, ECG sensor.',599,'Sports','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=220&fit=crop&auto=format'],
                ['Build and Become Brain Training Cards','Educational card game for logical thinking, ages 7+.',25,'Toys','https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format'],
                ['Ravensburger 5000-Piece Puzzle','Magnificent millennium Eiffel Tower, 153x101cm when completed.',49,'Toys','https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format'],
                ['Settlers of Catan','The world\'s best strategy game for 3-4 players.',44,'Toys','https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format'],
                ['UNO Card Game','Family classic card game, 2-10 players, ages 7+.',8,'Toys','https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format'],
                ['Mecanum Wheel Robot Car Kit','STEM educational 4WD robot car kit with app control.',89,'Toys','https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=400&h=220&fit=crop&auto=format'],
                ['Veuve Clicquot Brut Champagne','Yellow Label Brut, 750ml, blend of Pinot Noir and Chardonnay.',59,'Food','https://images.unsplash.com/photo-1557435453-de52cb7b18c2?w=400&h=220&fit=crop&auto=format'],
                ['Beluga Noble Vodka','Russian grain vodka, triple distilled, 700ml bottle.',65,'Food','https://images.unsplash.com/photo-1557435453-de52cb7b18c2?w=400&h=220&fit=crop&auto=format'],
                ['Whittaker\'s Dark Chocolate Box','Premium New Zealand dark chocolate, 72% cocoa, 250g.',12,'Food','https://images.unsplash.com/photo-1549740425-5e9ed4d8cd34?w=400&h=220&fit=crop&auto=format'],
                ['Juan Valdez Premium Coffee Beans','Colombian single-origin Arabica beans, 500g roasted.',22,'Food','https://images.unsplash.com/photo-1497935586351-b67a49e012bf?w=400&h=220&fit=crop&auto=format'],
                ['Himalayan Chef Pink Salt 10lb','Coarse grain, pure mineral salt, food-grade resealable bag.',29,'Food','https://images.unsplash.com/photo-1604152135912-04a022e23696?w=400&h=220&fit=crop&auto=format'],
                ['Tesla Model 3 Floor Mats','All-weather TPE, custom fit 3-piece set, lip edge.',119,'Automotive','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format'],
                ['Meguiar\'s Ultimate Polish','Non-abrasive paint polish with diminishing abrasives, 16 oz.',19,'Automotive','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format'],
                ['Blackvue DR970X-2CH Dashcam','4K front + 2K rear, built-in WiFi, GPS, parking mode.',499,'Automotive','https://images.unsplash.com/photo-1547628641-ec4f2a4de5d4?w=400&h=220&fit=crop&auto=format'],
                ['Covercraft Custom Car Cover','Form-fit, water-repellent Reflec\'tect fabric, UV protection.',299,'Automotive','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format'],
                ['K&N High-Flow Air Filter','Washable and reusable, 10-year/1M mile warranty.',60,'Automotive','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&h=220&fit=crop&auto=format'],
                ['Samsung The Frame 55" TV','Art Mode with customizable frames, matte display, QLED 4K.',1299,'Electronics','https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format'],
                ['LG C3 OLED 65" TV','evo OLED panel, α9 AI Processor, 120Hz, HDMI 2.1.',1599,'Electronics','https://images.unsplash.com/photo-1593784991095-a205069470b6?w=400&h=220&fit=crop&auto=format'],
                ['Sonos Arc Soundbar','Dolby Atmos, spatial audio, 11 high-performance drivers.',899,'Electronics','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                ['Bose Smart Soundbar 900','Adaptive Audio, Dolby Atmos, QuietPort technology, WiFi.',899,'Electronics','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                ['KEF LS50 Meta Bookshelf Speakers','MAT technology, Uni-Q driver array, 220W power handling.',1399,'Electronics','https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&h=220&fit=crop&auto=format'],
                ['Alo Yoga High-Waist Leggings','4-way stretch, moisture-wicking, squat-proof, 7/8 length.',98,'Sports','https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&h=220&fit=crop&auto=format'],
                ['Arc\'teryx Beta AR Jacket','Gore-Tex Pro, lightweight, packable, fully seam sealed.',800,'Outdoor','https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format'],
                ['Salomon X Ultra 4 GTX Hiking Boots','Gore-Tex waterproof, Contagrip MA sole, energized fit.',155,'Outdoor','https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=220&fit=crop&auto=format'],
                ['The North Face Summit Series Fleece','Polartec Power Stretch Pro, ultralight, 4-way stretch.',249,'Outdoor','https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format'],
                ['Filson Mackinaw Cruiser Jacket','Mackinaw Wool, heavy-duty, American-made, water-repellent.',595,'Fashion','https://images.unsplash.com/photo-1544923246-77307dd654cb?w=400&h=220&fit=crop&auto=format'],
                ['Montblanc Meisterstück Rollerball','Precious resin barrel, platinum-coated rings, smooth nib.',450,'Stationery','https://images.unsplash.com/photo-1585336261022-680e295ce3fe?w=400&h=220&fit=crop&auto=format'],
                ['Smythson Panama Notebook','Cross-grain leather, gilt-edged cream pages, ribbon marker.',95,'Stationery','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format'],
                ['Leuchtturm1917 Bullet Journal','Dotted grid, 240 pages, numbered pages, two ribbon bookmarks.',25,'Stationery','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=220&fit=crop&auto=format'],
                ['Pokémon TCG: Scarlet & Violet Booster Box','36 booster packs, potential for rare ex and illustration cards.',149,'Toys','https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format'],
                ['Magic: The Gathering Bundle Set','Bundle includes 8 set boosters, foil cards, and 40 basic lands.',45,'Toys','https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=400&h=220&fit=crop&auto=format'],
                ['Dyson Zone Air Purifying Headphones','Over-ear ANC headphones with air-purifying visor.',949,'Electronics','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format'],
                ['Bang & Olufsen Beoplay H95','Premium ANC headphones, 38-hour battery, aluminum construction.',799,'Electronics','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format'],
                ['Jabra Evolve2 85 Headset','Professional ANC, 10-microphone call technology, 37-hour battery.',499,'Electronics','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=220&fit=crop&auto=format'],
                ['Anker 733 Power Bank','3-in-1 charging station, 10,000mAh, 30W USB-C PD.',69,'Electronics','https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&h=220&fit=crop&auto=format'],
                ['Belkin BoostCharge Pro MagSafe Stand','3-in-1 wireless charging for iPhone, Apple Watch, AirPods.',149,'Electronics','https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&h=220&fit=crop&auto=format'],
                ['Fender Player Stratocaster','Alder body, 3 Player Series Alnico 5 pickups, maple neck.',849,'Music','https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=220&fit=crop&auto=format'],
                ['Gibson Les Paul Standard','AAA figured maple top, hand-rolled frets, ProBucker pickups.',2499,'Music','https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&h=220&fit=crop&auto=format'],
                ['Roland FP-90X Digital Piano','88-key PHA-50 keyboard, 384 voices, Bluetooth audio.',1999,'Music','https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=400&h=220&fit=crop&auto=format'],
                ['Bose SoundLink Max Portable Speaker','IP67 waterproof, 20-hour battery, PartyMode, 360° audio.',399,'Electronics','https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400&h=220&fit=crop&auto=format'],
                ['Harman Kardon Onyx Studio 8','Wireless Bluetooth speaker, 8-hour battery, Premium design.',249,'Electronics','https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400&h=220&fit=crop&auto=format'],
            ];
            const stmt = sqliteDb.prepare(
                `INSERT OR IGNORE INTO products (name, description, price, category, image_url, status) VALUES (?,?,?,?,?,'active')`
            );
            let added = 0;
            for (const p of seedProducts) {
                // Skip if already exists by name
                const exists = sqliteDb.exec(`SELECT id FROM products WHERE name=?`, [p[0]]);
                if (!exists.length || !exists[0].values.length) {
                    stmt.run(p);
                    added++;
                }
            }
            stmt.free();
            const dbData = sqliteDb.export(); fs.writeFileSync(DB_FILE, Buffer.from(dbData));
            console.log(`✅ Seeded ${added} new products (total catalog ready)`);
        } else {
            console.log(`✅ Products already seeded (${productCount} active)`);
        }
    } catch(e) { console.log('Products seed note:', e.message); }

    // ─── API Routes ───────────────────────────────────────────────────────────
    app.use('/api/auth',  require('./routes/auth'));
    app.use('/api/user',  require('./routes/user'));
    app.use('/api/tasks', require('./routes/tasks'));
    app.use('/api/admin', require('./routes/admin'));

    // Public settings (no auth required — for frontend logo/name display)
    app.get('/api/public/settings', async (req, res) => {
        try {
            const db = require('./config/db');
            const [rows] = await db.query(`SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('site_name','site_logo','support_email','support_telegram','event_countdown_date','event_featured','events_upcoming','about_story','telegram_link','whatsapp_link','cert_image')`);
            const map = {};
            rows.forEach(r => { map[r.setting_key] = r.setting_value; });
            res.json({ success: true, data: map });
        } catch(e) {
            res.json({ success: true, data: {} });
        }
    });

    app.get('/api/health', (req, res) => {
        res.json({ success: true, message: 'InvestPro API running!', timestamp: new Date() });
    });

    app.use((err, req, res, next) => {
        console.error('Error:', err.message);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    });

    // ─── Start ────────────────────────────────────────────────────────────────
    app.listen(PORT, () => {
        console.log('\n========================================');
        console.log(`  🚀 InvestPro is RUNNING!`);
        console.log('========================================');
        console.log(`  🌐 Website  : http://localhost:${PORT}`);
        console.log(`  🔐 Admin    : http://localhost:${PORT}/admin`);
        console.log(`  📡 API      : http://localhost:${PORT}/api`);
        console.log('========================================\n');
    });
}

startServer().catch(err => {
    console.error('❌ Failed to start:', err);
    process.exit(1);
});
