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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

    // Recovery: find the best DB (most users) among all versions on the volume
    const allCandidates = ['investpro.db','investpro_v1.db','investpro_v2.db','investpro_v3.db','investpro_v4.db'];
    let bestFile = null;
    let bestUserCount = -1;
    for (const name of allCandidates) {
        const candidate = path.join(dbDir, name);
        if (!fs.existsSync(candidate)) continue;
        try {
            const SQL2 = await initSqlJs();
            const tmpDb = new SQL2.Database(fs.readFileSync(candidate));
            const result = tmpDb.exec(`SELECT COUNT(*) as c FROM users`);
            const count = result[0]?.values[0][0] || 0;
            tmpDb.close();
            console.log(`📂 Found ${name}: ${count} users`);
            if (count > bestUserCount) { bestUserCount = count; bestFile = candidate; }
        } catch(e) { /* not a valid db */ }
    }
    if (bestFile && bestFile !== DB_FILE && bestUserCount > 0) {
        console.log(`♻️  Recovering DB from ${path.basename(bestFile)} (${bestUserCount} users) → ${path.basename(DB_FILE)}`);
        fs.copyFileSync(bestFile, DB_FILE);
    } else if (!fs.existsSync(DB_FILE)) {
        console.log('🆕 No existing DB found — will create fresh');
    }

    const isNewDb = !fs.existsSync(DB_FILE);
    const sqliteDb = isNewDb
        ? new SQL.Database()
        : new SQL.Database(fs.readFileSync(DB_FILE));
    sqliteDb.run('PRAGMA foreign_keys = ON');

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
         ['support_telegram','@investpro_support','Telegram handle'],
        ].forEach(s => sqliteDb.run(
            `INSERT OR IGNORE INTO settings (setting_key,setting_value,description) VALUES (?,?,?)`, s));

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

    // ─── Seed Products (up to 200) ────────────────────────────────────────────
    try {
        const existing = sqliteDb.exec(`SELECT COUNT(*) as c FROM products WHERE status='active'`);
        const productCount = existing[0]?.values[0][0] || 0;
        if (productCount < 200) {
            const seedProducts = [
                // Electronics
                ['iPhone 15 Pro Max','Apple flagship smartphone with A17 Pro chip, titanium frame and 48MP camera system.',1199,'Electronics','https://picsum.photos/seed/p1/400/220'],
                ['Samsung Galaxy S24 Ultra','Android powerhouse with 200MP camera, S Pen stylus and 5000mAh battery.',1099,'Electronics','https://picsum.photos/seed/p2/400/220'],
                ['MacBook Pro 14"','Apple M3 Pro chip, Liquid Retina XDR display, 18-hour battery life.',1999,'Electronics','https://picsum.photos/seed/p3/400/220'],
                ['Dell XPS 15 Laptop','15.6" OLED display, Intel Core i9, 32GB RAM, 1TB SSD.',1799,'Electronics','https://picsum.photos/seed/p4/400/220'],
                ['Sony WH-1000XM5','Industry-leading noise cancelling headphones with 30-hour battery.',349,'Electronics','https://picsum.photos/seed/p5/400/220'],
                ['iPad Pro 12.9"','M2 chip, Liquid Retina XDR display, USB-C with Thunderbolt.',1099,'Electronics','https://picsum.photos/seed/p6/400/220'],
                ['Apple Watch Ultra 2','Rugged titanium smartwatch with precision dual-frequency GPS.',799,'Electronics','https://picsum.photos/seed/p7/400/220'],
                ['Sony A7R V Camera','61MP full-frame mirrorless camera with AI-powered autofocus.',3899,'Electronics','https://picsum.photos/seed/p8/400/220'],
                ['Samsung 65" QLED TV','4K QLED Smart TV with Quantum HDR and 120Hz refresh rate.',1499,'Electronics','https://picsum.photos/seed/p9/400/220'],
                ['Canon EOS R6 Mark II','Full-frame mirrorless camera with 40fps burst shooting.',2499,'Electronics','https://picsum.photos/seed/p10/400/220'],
                ['DJI Mini 4 Pro','Compact foldable drone with 4K/60fps video and obstacle sensing.',759,'Electronics','https://picsum.photos/seed/p11/400/220'],
                ['PlayStation 5','Next-gen gaming console with ultra-high speed SSD and DualSense controller.',499,'Electronics','https://picsum.photos/seed/p12/400/220'],
                ['Xbox Series X','4K gaming at 60fps, 12 teraflops of processing power.',499,'Electronics','https://picsum.photos/seed/p13/400/220'],
                ['Nintendo Switch OLED','Vibrant 7-inch OLED screen, enhanced audio, 64GB storage.',349,'Electronics','https://picsum.photos/seed/p14/400/220'],
                ['AirPods Pro 2nd Gen','Active noise cancellation, Adaptive Audio, and MagSafe charging.',249,'Electronics','https://picsum.photos/seed/p15/400/220'],
                ['Bose QuietComfort 45','World-class noise cancelling wireless headphones.',329,'Electronics','https://picsum.photos/seed/p16/400/220'],
                ['Samsung Galaxy Watch 6','Advanced health monitoring with BioActive Sensor and sapphire glass.',299,'Electronics','https://picsum.photos/seed/p17/400/220'],
                ['GoPro Hero 12','5.3K60 video, HyperSmooth 6.0, waterproof to 10m.',399,'Electronics','https://picsum.photos/seed/p18/400/220'],
                ['Kindle Paperwhite','6.8" display, adjustable warm light, waterproof, 10-week battery.',139,'Electronics','https://picsum.photos/seed/p19/400/220'],
                ['Apple TV 4K','Cinematic mode, spatial audio, and the power of A15 Bionic.',129,'Electronics','https://picsum.photos/seed/p20/400/220'],
                // Fashion & Clothing
                ['Nike Air Max 270','Lightweight upper, Max Air heel unit for all-day comfort.',150,'Fashion','https://picsum.photos/seed/p21/400/220'],
                ['Adidas Ultraboost 23','Responsive Boost midsole, Primeknit upper, Continental rubber.',190,'Fashion','https://picsum.photos/seed/p22/400/220'],
                ['Ray-Ban Aviator Classic','Iconic polarized sunglasses with gold metal frame.',173,'Fashion','https://picsum.photos/seed/p23/400/220'],
                ["Levi's 501 Original Jeans",'Classic straight fit denim jeans, button fly, 100% cotton.',69,'Fashion','https://picsum.photos/seed/p24/400/220'],
                ['Gucci GG Canvas Tote','Luxury canvas tote bag with iconic GG print and leather trim.',950,'Fashion','https://picsum.photos/seed/p25/400/220'],
                ['Canada Goose Parka','Premium expedition parka with Arctic Tech shell, fur-trimmed hood.',895,'Fashion','https://picsum.photos/seed/p26/400/220'],
                ['Rolex Submariner','Iconic dive watch, 300m waterproof, Cerachrom bezel, Oyster bracelet.',9150,'Jewelry','https://picsum.photos/seed/p27/400/220'],
                ['Louis Vuitton Speedy 25','Classic monogram canvas handbag with leather trim and padlock.',1050,'Fashion','https://picsum.photos/seed/p28/400/220'],
                ['Hermès Silk Scarf','100% silk twill scarf, hand-rolled edges, iconic print.',450,'Fashion','https://picsum.photos/seed/p29/400/220'],
                ['New Balance 990v6','Made in USA, premium suede and mesh upper, ENCAP midsole.',185,'Fashion','https://picsum.photos/seed/p30/400/220'],
                ['Prada Nylon Backpack','Re-Nylon backpack with Saffiano leather trims and adjustable straps.',1150,'Fashion','https://picsum.photos/seed/p31/400/220'],
                ['Balenciaga Triple S','Chunky layered-sole sneakers in mesh and leather.',895,'Fashion','https://picsum.photos/seed/p32/400/220'],
                ['Patagonia Better Sweater','Fleece jacket with recycled polyester, full-zip, classic fit.',139,'Fashion','https://picsum.photos/seed/p33/400/220'],
                ['Ralph Lauren Polo Shirt','Classic cotton piqué polo with embroidered Polo Pony.',89,'Fashion','https://picsum.photos/seed/p34/400/220'],
                ['Converse Chuck Taylor All Star','Classic hi-top canvas sneaker with signature rubber sole.',60,'Fashion','https://picsum.photos/seed/p35/400/220'],
                // Home & Kitchen
                ['Dyson V15 Detect','Laser dust detection, 60 min runtime, HEPA filtration.',749,'Home','https://picsum.photos/seed/p36/400/220'],
                ['Instant Pot Duo 7-in-1','Pressure cooker, slow cooker, rice cooker, steamer, sauté, yogurt maker.',99,'Kitchen','https://picsum.photos/seed/p37/400/220'],
                ['KitchenAid Stand Mixer','5-quart tilt-head stand mixer with 10 speeds, 59 attachments available.',449,'Kitchen','https://picsum.photos/seed/p38/400/220'],
                ['Nespresso Vertuo Next','Coffee and espresso machine with centrifusion technology.',179,'Kitchen','https://picsum.photos/seed/p39/400/220'],
                ['Vitamix 5200 Blender','Variable speed control, self-cleaning, aircraft-grade stainless steel.',449,'Kitchen','https://picsum.photos/seed/p40/400/220'],
                ['Philips Hue Starter Kit','Smart LED bulbs with bridge, 16 million colors, voice control.',129,'Home','https://picsum.photos/seed/p41/400/220'],
                ['Roomba j7+ Robot Vacuum','Self-emptying, obstacle avoidance, smart mapping, Alexa compatible.',599,'Home','https://picsum.photos/seed/p42/400/220'],
                ['Ninja Foodi Air Fryer','6-in-1 DualZone air fryer, 8-quart capacity, 6 cooking functions.',199,'Kitchen','https://picsum.photos/seed/p43/400/220'],
                ['Casper Wave Hybrid Mattress','Zoned ergonomic support, 7 layers including gel pods.',2995,'Bedroom','https://picsum.photos/seed/p44/400/220'],
                ['Weber Genesis E-325s Gas Grill','3 burners, sear station, iGrill3 compatible, 10-year warranty.',999,'Outdoor','https://picsum.photos/seed/p45/400/220'],
                ['Le Creuset Dutch Oven','Enameled cast iron, 5.5-quart, chip and crack resistant enamel.',399,'Kitchen','https://picsum.photos/seed/p46/400/220'],
                ['Breville Barista Express','Built-in conical burr grinder, 15-bar pump, steam wand.',699,'Kitchen','https://picsum.photos/seed/p47/400/220'],
                ['Nest Learning Thermostat','Auto-schedule, energy-saving, remote control, compatible with Alexa.',249,'Home','https://picsum.photos/seed/p48/400/220'],
                ['Ring Video Doorbell Pro 2','1536p HD, 3D motion detection, bird\'s eye view, two-way talk.',249,'Home','https://picsum.photos/seed/p49/400/220'],
                ['Shark IQ Robot Vacuum','Self-empty base, home mapping, WiFi, voice control.',499,'Home','https://picsum.photos/seed/p50/400/220'],
                // Sports & Fitness
                ['Peloton Bike+','22" rotating HD touchscreen, auto-resistance, live and on-demand classes.',2495,'Sports','https://picsum.photos/seed/p51/400/220'],
                ['Hydro Flask 32oz','Double-wall vacuum insulation, TempShield, BPA-free stainless steel.',44,'Sports','https://picsum.photos/seed/p52/400/220'],
                ['Garmin Fenix 7X Solar','Multisport GPS watch, solar charging, 37-day battery, titanium.',899,'Sports','https://picsum.photos/seed/p53/400/220'],
                ['Yeti Tundra 45 Cooler','Rotomolded construction, PermaFrost insulation, bearproof certified.',325,'Outdoor','https://picsum.photos/seed/p54/400/220'],
                ['Lululemon Align Leggings','Buttery-soft Nulu fabric, 28" inseam, four-way stretch.',98,'Sports','https://picsum.photos/seed/p55/400/220'],
                ['Under Armour HOVR Phantom 3','Connected running shoe with MapMyRun app integration.',130,'Sports','https://picsum.photos/seed/p56/400/220'],
                ['Bowflex SelectTech 552 Dumbbells','Adjustable 5-52.5 lbs, 15 weight settings, replaces 15 sets.',429,'Sports','https://picsum.photos/seed/p57/400/220'],
                ['TRX PRO4 Suspension Trainer','Military-grade, 6 anchor points, full-body workout anywhere.',249,'Sports','https://picsum.photos/seed/p58/400/220'],
                ['Manduka PRO Yoga Mat','6mm thick, non-toxic PVC, lifetime guarantee, 71" length.',120,'Sports','https://picsum.photos/seed/p59/400/220'],
                ['Trek Marlin 7 Mountain Bike','Aluminum frame, RockShox 30 Silver fork, Shimano hydraulic disc brakes.',849,'Sports','https://picsum.photos/seed/p60/400/220'],
                ['Callaway Rogue ST Driver','Jailbreak AI Speed Frame, Triaxial Carbon Crown, 460cc head.',499,'Sports','https://picsum.photos/seed/p61/400/220'],
                ['Wilson Pro Staff Tennis Racquet','97 sq in head, 11.2oz, 16x19 string pattern.',229,'Sports','https://picsum.photos/seed/p62/400/220'],
                // Beauty & Personal Care
                ['La Mer Moisturizing Cream','Miracle Broth formula, 60ml, restores skin with sea kelp.',340,'Beauty','https://picsum.photos/seed/p63/400/220'],
                ['Dyson Airwrap Complete','Multi-styler with Coanda effect, 6 attachments, auto air direction.',599,'Beauty','https://picsum.photos/seed/p64/400/220'],
                ['Charlotte Tilbury Magic Cream','Moisturiser with hyaluronic acid, rose hip, and vitamin C complex.',105,'Beauty','https://picsum.photos/seed/p65/400/220'],
                ['Olaplex No.3 Hair Perfector','At-home treatment to strengthen hair and reduce breakage.',28,'Beauty','https://picsum.photos/seed/p66/400/220'],
                ['FOREO LUNA 4','T-Sonic facial cleansing device, 16 intensities, app connected.',199,'Beauty','https://picsum.photos/seed/p67/400/220'],
                ['SK-II Facial Treatment Essence','Pitera formula, improves skin clarity and texture, 230ml.',185,'Beauty','https://picsum.photos/seed/p68/400/220'],
                ['NuFACE Trinity Facial Toner','FDA-cleared microcurrent device with interchangeable attachments.',339,'Beauty','https://picsum.photos/seed/p69/400/220'],
                ['Tatcha The Water Cream','Oil-free pore-minimizing moisturizer with Japanese lilly extract.',68,'Beauty','https://picsum.photos/seed/p70/400/220'],
                ['Drunk Elephant Protini Polypeptide Cream','Signal peptide complex, amino acid blend, moisturizing formula.',68,'Beauty','https://picsum.photos/seed/p71/400/220'],
                ['Sunday Riley Good Genes','Lactic acid treatment, clarifying serum, brightens complexion.',85,'Beauty','https://picsum.photos/seed/p72/400/220'],
                // Jewelry & Watches
                ['Cartier Love Bracelet','18K yellow gold, 6 diamonds, screwdriver clasp, 6.1mm wide.',6900,'Jewelry','https://picsum.photos/seed/p73/400/220'],
                ['Tiffany T Wire Bracelet','Sterling silver open wire bracelet, medium size.',375,'Jewelry','https://picsum.photos/seed/p74/400/220'],
                ['Omega Seamaster 300M','Co-Axial Master Chronometer, ceramic bezel, bracelet strap.',5900,'Jewelry','https://picsum.photos/seed/p75/400/220'],
                ['Pandora Moments Bracelet','Sterling silver snake chain with barrel clasp, 19cm.',65,'Jewelry','https://picsum.photos/seed/p76/400/220'],
                ['TAG Heuer Carrera','Calibre 5 automatic, 39mm case, sapphire crystal, date display.',1650,'Jewelry','https://picsum.photos/seed/p77/400/220'],
                ['Diamond Stud Earrings','0.5 carat total weight, GIA certified, set in 14K white gold.',999,'Jewelry','https://picsum.photos/seed/p78/400/220'],
                ['Swarovski Infinity Necklace','Rhodium-plated necklace with infinity pendant, clear crystals.',89,'Jewelry','https://picsum.photos/seed/p79/400/220'],
                ['IWC Schaffhausen Pilot Watch','Automatic, 41mm, anti-reflective sapphire crystal, leather strap.',4800,'Jewelry','https://picsum.photos/seed/p80/400/220'],
                // Books & Media
                ['The Great Gatsby - F. Scott Fitzgerald','Classic novel set in the Roaring Twenties. Scribner edition.',15,'Books','https://picsum.photos/seed/p81/400/220'],
                ['Atomic Habits - James Clear','Proven framework for getting 1% better every day.',27,'Books','https://picsum.photos/seed/p82/400/220'],
                ['The Psychology of Money','Timeless lessons on wealth, greed, and happiness.',19,'Books','https://picsum.photos/seed/p83/400/220'],
                ['Dune - Frank Herbert','Classic sci-fi epic, Hugo and Nebula Award winner.',18,'Books','https://picsum.photos/seed/p84/400/220'],
                ['The 7 Habits of Highly Effective People','Powerful lessons in personal change by Stephen Covey.',17,'Books','https://picsum.photos/seed/p85/400/220'],
                // Automotive
                ['Michelin Pilot Sport 4S Tires','Ultra-high performance summer tire, 245/40R18, set of 4.',899,'Automotive','https://picsum.photos/seed/p86/400/220'],
                ['NOCO Genius5 Battery Charger','5-amp smart charger for 6V/12V lead-acid batteries.',69,'Automotive','https://picsum.photos/seed/p87/400/220'],
                ['Garmin DriveSmart 65 GPS','6.95" display, driver alerts, live traffic, hands-free calling.',199,'Automotive','https://picsum.photos/seed/p88/400/220'],
                ['Thule Pulse M Rooftop Cargo Box','12 cubic feet, fits most cars, aerodynamic design.',599,'Automotive','https://picsum.photos/seed/p89/400/220'],
                ['Chemical Guys Complete Car Care Kit','Detailing kit with 16 products, buffer, and pads.',149,'Automotive','https://picsum.photos/seed/p90/400/220'],
                // Toys & Games
                ['LEGO Technic Bugatti Chiron','3599 pieces, 1:8 scale, working engine and gearbox.',449,'Toys','https://picsum.photos/seed/p91/400/220'],
                ['Hasbro Monopoly Classic','Classic board game for 2-6 players, includes tokens and dice.',22,'Toys','https://picsum.photos/seed/p92/400/220'],
                ['Fisher-Price Little People Farm','Realistic farm sounds, 12 pieces, suitable for ages 1-5.',34,'Toys','https://picsum.photos/seed/p93/400/220'],
                ['Nerf Elite 2.0 Commander','20-dart revolving drum, pull-back priming, fires 27m.',40,'Toys','https://picsum.photos/seed/p94/400/220'],
                ['Hot Wheels Ultimate Garage','5-lane spiral, 2 elevators, 140+ car storage.',99,'Toys','https://picsum.photos/seed/p95/400/220'],
                // Food & Grocery
                ['Manuka Honey UMF 20+','Premium New Zealand Manuka honey, 250g jar.',79,'Food','https://picsum.photos/seed/p96/400/220'],
                ['Godiva Chocolatier 24-Piece Box','Assorted Belgian chocolates, milk and dark varieties.',55,'Food','https://picsum.photos/seed/p97/400/220'],
                ['Illy Espresso Coffee 250g','100% Arabica fine ground espresso, classic medium roast.',19,'Food','https://picsum.photos/seed/p98/400/220'],
                ['Himalayan Pink Salt Grinder','Coarse grain, mineral-rich, food-grade glass grinder.',12,'Food','https://picsum.photos/seed/p99/400/220'],
                ['Twinings English Breakfast Tea','80 tea bags, classic full-bodied black tea blend.',8,'Food','https://picsum.photos/seed/p100/400/220'],
                // Additional products 101-200
                ['Google Pixel 8 Pro','6.7" LTPO OLED, Tensor G3 chip, 50MP camera, 7 years of updates.',999,'Electronics','https://picsum.photos/seed/p101/400/220'],
                ['OnePlus 12','6.82" AMOLED 120Hz, Snapdragon 8 Gen 3, 100W charging.',799,'Electronics','https://picsum.photos/seed/p102/400/220'],
                ['Microsoft Surface Pro 10','13" PixelSense Flow display, Intel Core Ultra, Copilot+ PC.',1599,'Electronics','https://picsum.photos/seed/p103/400/220'],
                ['Lenovo ThinkPad X1 Carbon','14" 2.8K OLED, Intel Core i7 vPro, 57Wh battery, MIL-SPEC.',1899,'Electronics','https://picsum.photos/seed/p104/400/220'],
                ['ASUS ROG Strix Gaming Monitor','27" QHD 165Hz IPS, G-Sync Compatible, 1ms GTG, HDR400.',499,'Electronics','https://picsum.photos/seed/p105/400/220'],
                ['Logitech MX Master 3S','8K DPI sensor, MagSpeed scroll wheel, USB-C, Bluetooth.',99,'Electronics','https://picsum.photos/seed/p106/400/220'],
                ['Corsair K100 RGB Keyboard','Optical-mechanical switches, per-key RGB, iCUE software.',229,'Electronics','https://picsum.photos/seed/p107/400/220'],
                ['Samsung T9 Portable SSD','4TB, USB 3.2 Gen 2x2, 2000MB/s, military-grade shock resistance.',349,'Electronics','https://picsum.photos/seed/p108/400/220'],
                ['WD Black SN850X NVMe SSD','2TB, PCIe 4.0, 7300MB/s read, heatsink edition.',199,'Electronics','https://picsum.photos/seed/p109/400/220'],
                ['NVIDIA GeForce RTX 4080 Super','16GB GDDR6X, DLSS 3, ray tracing, 4K gaming performance.',999,'Electronics','https://picsum.photos/seed/p110/400/220'],
                ['Jordan 1 Retro High OG','Chicago colorway, tumbled leather upper, Air cushioning.',180,'Fashion','https://picsum.photos/seed/p111/400/220'],
                ['Yeezy Boost 350 V2','Primeknit upper, BOOST midsole, Adidas Originals collab.',220,'Fashion','https://picsum.photos/seed/p112/400/220'],
                ['Dior Oblique Saddle Bag','Dior Oblique jacquard canvas, grained calfskin trim.',2900,'Fashion','https://picsum.photos/seed/p113/400/220'],
                ['Burberry Cashmere Scarf','Giant check pattern, 100% cashmere, fringe edge.',450,'Fashion','https://picsum.photos/seed/p114/400/220'],
                ['Moncler Grenoble Down Jacket','700-fill goose down, water-repellent, stretch woven fabric.',895,'Fashion','https://picsum.photos/seed/p115/400/220'],
                ['Valentino Garavani Rockstud Pumps','105mm heel, leather upper, signature pyramid studs.',995,'Fashion','https://picsum.photos/seed/p116/400/220'],
                ['Saint Laurent Kate Belt Bag','Grain de poudre embossed leather, YSL clasp, adjustable strap.',1150,'Fashion','https://picsum.photos/seed/p117/400/220'],
                ['Acne Studios Wool Blend Coat','Oversized silhouette, dropped shoulders, single button.',1100,'Fashion','https://picsum.photos/seed/p118/400/220'],
                ['Bottega Veneta Jodie Bag','Woven intrecciato leather, knotted handle, minimalist design.',2100,'Fashion','https://picsum.photos/seed/p119/400/220'],
                ['Stone Island Crewneck Sweatshirt','Fleece cotton, iconic compass patch, garment dyed.',295,'Fashion','https://picsum.photos/seed/p120/400/220'],
                ['Traeger Pro 780 Pellet Grill','WiFIRE technology, 780 sq in cooking area, Super Smoke mode.',899,'Outdoor','https://picsum.photos/seed/p121/400/220'],
                ['Cuisinart 12-Piece Stainless Cookware','Tri-ply construction, dishwasher safe, oven safe to 550°F.',299,'Kitchen','https://picsum.photos/seed/p122/400/220'],
                ['Nespresso Lattissima One','Automatic frothed milk, 5 beverage sizes, compact design.',299,'Kitchen','https://picsum.photos/seed/p123/400/220'],
                ['Breville Smart Oven Air Fryer Pro','13-in-1 countertop oven, 1800W, Super Convection technology.',399,'Kitchen','https://picsum.photos/seed/p124/400/220'],
                ['All-Clad D3 Stainless 10-Piece','Tri-ply bonded cookware, oven safe to 600°F, induction compatible.',599,'Kitchen','https://picsum.photos/seed/p125/400/220'],
                ['Saatva Classic Mattress','Luxury innerspring, Euro pillow top, 365-day return policy.',1795,'Bedroom','https://picsum.photos/seed/p126/400/220'],
                ['TEMPUR-Adapt Medium Pillow','TEMPUR material, ergonomic shape, removable cover.',169,'Bedroom','https://picsum.photos/seed/p127/400/220'],
                ['Purple Mattress Hybrid Premier','Purple Grid technology, responsive coils, cooling cover.',2299,'Bedroom','https://picsum.photos/seed/p128/400/220'],
                ['Dyson Pure Cool Air Purifier','HEPA + activated carbon filter, 350° oscillation, app control.',549,'Home','https://picsum.photos/seed/p129/400/220'],
                ['LG InstaView French Door Refrigerator','27 cu ft, InstaView door-in-door, Craft Ice maker.',2799,'Home','https://picsum.photos/seed/p130/400/220'],
                ['Apple Fitness+ Annual Plan','Annual subscription for guided workouts, yoga, meditation.',79,'Fitness','https://picsum.photos/seed/p131/400/220'],
                ['NordicTrack Commercial 1750 Treadmill','14" smart HD touchscreen, iFIT, 10% incline and -3% decline.',1799,'Sports','https://picsum.photos/seed/p132/400/220'],
                ['Schwinn IC4 Indoor Cycling Bike','100 magnetic resistance levels, Bluetooth, 40 lb flywheel.',899,'Sports','https://picsum.photos/seed/p133/400/220'],
                ['Rogue Monster Squat Stand','11-gauge steel, 1000 lb capacity, westside hole spacing.',895,'Sports','https://picsum.photos/seed/p134/400/220'],
                ['Theragun Pro 5th Gen','Proprietary brushless motor, 60-min battery, Bluetooth app.',399,'Sports','https://picsum.photos/seed/p135/400/220'],
                ['WHOOP 4.0 Wristband','Continuous health monitoring, strain coaching, recovery score.',239,'Sports','https://picsum.photos/seed/p136/400/220'],
                ['Osprey Atmos AG 65 Backpack','Anti-Gravity suspension, 65L, raincover included, hipbelt pockets.',270,'Outdoor','https://picsum.photos/seed/p137/400/220'],
                ['Black Diamond Spot 400 Headlamp','400 lumens, IPX8 waterproof, red night vision mode.',45,'Outdoor','https://picsum.photos/seed/p138/400/220'],
                ['MSR WhisperLite Universal Stove','Multi-fuel, 9000 BTU, compatible with MSR fuel bottles.',119,'Outdoor','https://picsum.photos/seed/p139/400/220'],
                ['Nalgene Wide Mouth 32oz','BPA-free Tritan plastic, loop-top lid, dishwasher safe.',15,'Outdoor','https://picsum.photos/seed/p140/400/220'],
                ['Estée Lauder Advanced Night Repair','Serum synchronized recovery complex II, 50ml.',115,'Beauty','https://picsum.photos/seed/p141/400/220'],
                ['La Prairie White Caviar Illuminating Cream','Caviar Extract, advanced brightening complex, 60ml.',895,'Beauty','https://picsum.photos/seed/p142/400/220'],
                ['SkinCeuticals C E Ferulic','Vitamin C antioxidant treatment serum, 1 fl oz.',182,'Beauty','https://picsum.photos/seed/p143/400/220'],
                ['Augustinus Bader The Rich Cream','TFC8 complex, luxurious moisturizer, 50ml.',265,'Beauty','https://picsum.photos/seed/p144/400/220'],
                ['Lancôme Génifique Advanced Youth Activating Concentrate','Pro-xylane, bifidus prebiotic, 50ml serum.',115,'Beauty','https://picsum.photos/seed/p145/400/220'],
                ['Sisley Black Rose Precious Face Oil','8 precious oils with Black Rose extract, 25ml.',285,'Beauty','https://picsum.photos/seed/p146/400/220'],
                ['Kiehl\'s Ultra Facial Cream SPF 30','24-hour hydration, broad spectrum SPF 30, 50ml.',39,'Beauty','https://picsum.photos/seed/p147/400/220'],
                ['Sulwhasoo Snowise Brightening Serum','Mulberry root extract, brightening complex, 30ml.',125,'Beauty','https://picsum.photos/seed/p148/400/220'],
                ['PIXI Glow Tonic','Aloe vera, ginseng, glycolic acid toner, 250ml.',29,'Beauty','https://picsum.photos/seed/p149/400/220'],
                ['Mario Badescu Facial Spray','Rose water, herbs, and rosewater refreshing mist, 118ml.',9,'Beauty','https://picsum.photos/seed/p150/400/220'],
                ['Van Cleef & Arpels Alhambra Necklace','18K yellow gold, malachite clover motif pendant.',4350,'Jewelry','https://picsum.photos/seed/p151/400/220'],
                ['Bulgari Serpenti Bracelet','18K rose gold, pavé diamonds, serpent head clasp.',18500,'Jewelry','https://picsum.photos/seed/p152/400/220'],
                ['Chopard Happy Diamonds Earrings','18K white gold, floating diamonds, floral motif.',4500,'Jewelry','https://picsum.photos/seed/p153/400/220'],
                ['Mejuri Bold Chain Necklace','14K yellow gold-filled, adjustable 16"-18", lobster clasp.',165,'Jewelry','https://picsum.photos/seed/p154/400/220'],
                ['Monica Vinader Fiji Ring','18K rose gold vermeil, hammered texture, stackable.',95,'Jewelry','https://picsum.photos/seed/p155/400/220'],
                ['Audemars Piguet Royal Oak','37mm, 18K pink gold, self-winding, "tapisserie" dial.',35000,'Jewelry','https://picsum.photos/seed/p156/400/220'],
                ['Patek Philippe Nautilus','40mm, stainless steel, blue horizontal embossed dial.',34000,'Jewelry','https://picsum.photos/seed/p157/400/220'],
                ['Garmin Epix Pro Solar','Sapphire glass, titanium bezel, solar charging, 89-day battery.',1299,'Sports','https://picsum.photos/seed/p158/400/220'],
                ['Suunto Race S','49mm titanium, AMOLED 1.43" display, 40-day battery.',599,'Sports','https://picsum.photos/seed/p159/400/220'],
                ['Polar Vantage V3','AMOLED 1.39" display, dual-frequency GPS, ECG sensor.',599,'Sports','https://picsum.photos/seed/p160/400/220'],
                ['Build and Become Brain Training Cards','Educational card game for logical thinking, ages 7+.',25,'Toys','https://picsum.photos/seed/p161/400/220'],
                ['Ravensburger 5000-Piece Puzzle','Magnificent millennium Eiffel Tower, 153x101cm when completed.',49,'Toys','https://picsum.photos/seed/p162/400/220'],
                ['Settlers of Catan','The world\'s best strategy game for 3-4 players.',44,'Toys','https://picsum.photos/seed/p163/400/220'],
                ['UNO Card Game','Family classic card game, 2-10 players, ages 7+.',8,'Toys','https://picsum.photos/seed/p164/400/220'],
                ['Mecanum Wheel Robot Car Kit','STEM educational 4WD robot car kit with app control.',89,'Toys','https://picsum.photos/seed/p165/400/220'],
                ['Veuve Clicquot Brut Champagne','Yellow Label Brut, 750ml, blend of Pinot Noir and Chardonnay.',59,'Food','https://picsum.photos/seed/p166/400/220'],
                ['Beluga Noble Vodka','Russian grain vodka, triple distilled, 700ml bottle.',65,'Food','https://picsum.photos/seed/p167/400/220'],
                ['Whittaker\'s Dark Chocolate Box','Premium New Zealand dark chocolate, 72% cocoa, 250g.',12,'Food','https://picsum.photos/seed/p168/400/220'],
                ['Juan Valdez Premium Coffee Beans','Colombian single-origin Arabica beans, 500g roasted.',22,'Food','https://picsum.photos/seed/p169/400/220'],
                ['Himalayan Chef Pink Salt 10lb','Coarse grain, pure mineral salt, food-grade resealable bag.',29,'Food','https://picsum.photos/seed/p170/400/220'],
                ['Tesla Model 3 Floor Mats','All-weather TPE, custom fit 3-piece set, lip edge.',119,'Automotive','https://picsum.photos/seed/p171/400/220'],
                ['Meguiar\'s Ultimate Polish','Non-abrasive paint polish with diminishing abrasives, 16 oz.',19,'Automotive','https://picsum.photos/seed/p172/400/220'],
                ['Blackvue DR970X-2CH Dashcam','4K front + 2K rear, built-in WiFi, GPS, parking mode.',499,'Automotive','https://picsum.photos/seed/p173/400/220'],
                ['Covercraft Custom Car Cover','Form-fit, water-repellent Reflec\'tect fabric, UV protection.',299,'Automotive','https://picsum.photos/seed/p174/400/220'],
                ['K&N High-Flow Air Filter','Washable and reusable, 10-year/1M mile warranty.',60,'Automotive','https://picsum.photos/seed/p175/400/220'],
                ['Samsung The Frame 55" TV','Art Mode with customizable frames, matte display, QLED 4K.',1299,'Electronics','https://picsum.photos/seed/p176/400/220'],
                ['LG C3 OLED 65" TV','evo OLED panel, α9 AI Processor, 120Hz, HDMI 2.1.',1599,'Electronics','https://picsum.photos/seed/p177/400/220'],
                ['Sonos Arc Soundbar','Dolby Atmos, spatial audio, 11 high-performance drivers.',899,'Electronics','https://picsum.photos/seed/p178/400/220'],
                ['Bose Smart Soundbar 900','Adaptive Audio, Dolby Atmos, QuietPort technology, WiFi.',899,'Electronics','https://picsum.photos/seed/p179/400/220'],
                ['KEF LS50 Meta Bookshelf Speakers','MAT technology, Uni-Q driver array, 220W power handling.',1399,'Electronics','https://picsum.photos/seed/p180/400/220'],
                ['Alo Yoga High-Waist Leggings','4-way stretch, moisture-wicking, squat-proof, 7/8 length.',98,'Sports','https://picsum.photos/seed/p181/400/220'],
                ['Arc\'teryx Beta AR Jacket','Gore-Tex Pro, lightweight, packable, fully seam sealed.',800,'Outdoor','https://picsum.photos/seed/p182/400/220'],
                ['Salomon X Ultra 4 GTX Hiking Boots','Gore-Tex waterproof, Contagrip MA sole, energized fit.',155,'Outdoor','https://picsum.photos/seed/p183/400/220'],
                ['The North Face Summit Series Fleece','Polartec Power Stretch Pro, ultralight, 4-way stretch.',249,'Outdoor','https://picsum.photos/seed/p184/400/220'],
                ['Filson Mackinaw Cruiser Jacket','Mackinaw Wool, heavy-duty, American-made, water-repellent.',595,'Fashion','https://picsum.photos/seed/p185/400/220'],
                ['Montblanc Meisterstück Rollerball','Precious resin barrel, platinum-coated rings, smooth nib.',450,'Stationery','https://picsum.photos/seed/p186/400/220'],
                ['Smythson Panama Notebook','Cross-grain leather, gilt-edged cream pages, ribbon marker.',95,'Stationery','https://picsum.photos/seed/p187/400/220'],
                ['Leuchtturm1917 Bullet Journal','Dotted grid, 240 pages, numbered pages, two ribbon bookmarks.',25,'Stationery','https://picsum.photos/seed/p188/400/220'],
                ['Pokémon TCG: Scarlet & Violet Booster Box','36 booster packs, potential for rare ex and illustration cards.',149,'Toys','https://picsum.photos/seed/p189/400/220'],
                ['Magic: The Gathering Bundle Set','Bundle includes 8 set boosters, foil cards, and 40 basic lands.',45,'Toys','https://picsum.photos/seed/p190/400/220'],
                ['Dyson Zone Air Purifying Headphones','Over-ear ANC headphones with air-purifying visor.',949,'Electronics','https://picsum.photos/seed/p191/400/220'],
                ['Bang & Olufsen Beoplay H95','Premium ANC headphones, 38-hour battery, aluminum construction.',799,'Electronics','https://picsum.photos/seed/p192/400/220'],
                ['Jabra Evolve2 85 Headset','Professional ANC, 10-microphone call technology, 37-hour battery.',499,'Electronics','https://picsum.photos/seed/p193/400/220'],
                ['Anker 733 Power Bank','3-in-1 charging station, 10,000mAh, 30W USB-C PD.',69,'Electronics','https://picsum.photos/seed/p194/400/220'],
                ['Belkin BoostCharge Pro MagSafe Stand','3-in-1 wireless charging for iPhone, Apple Watch, AirPods.',149,'Electronics','https://picsum.photos/seed/p195/400/220'],
                ['Fender Player Stratocaster','Alder body, 3 Player Series Alnico 5 pickups, maple neck.',849,'Music','https://picsum.photos/seed/p196/400/220'],
                ['Gibson Les Paul Standard','AAA figured maple top, hand-rolled frets, ProBucker pickups.',2499,'Music','https://picsum.photos/seed/p197/400/220'],
                ['Roland FP-90X Digital Piano','88-key PHA-50 keyboard, 384 voices, Bluetooth audio.',1999,'Music','https://picsum.photos/seed/p198/400/220'],
                ['Bose SoundLink Max Portable Speaker','IP67 waterproof, 20-hour battery, PartyMode, 360° audio.',399,'Electronics','https://picsum.photos/seed/p199/400/220'],
                ['Harman Kardon Onyx Studio 8','Wireless Bluetooth speaker, 8-hour battery, Premium design.',249,'Electronics','https://picsum.photos/seed/p200/400/220'],
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
