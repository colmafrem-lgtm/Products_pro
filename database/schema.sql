-- ============================================
-- Investment Commission Platform - Database
-- ============================================

CREATE DATABASE IF NOT EXISTS investment_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE investment_db;

-- Users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    phone VARCHAR(20),
    referral_code VARCHAR(20) UNIQUE,
    referred_by INT DEFAULT NULL,
    balance DECIMAL(15,2) DEFAULT 0.00,
    total_earned DECIMAL(15,2) DEFAULT 0.00,
    vip_level INT DEFAULT 1,
    status ENUM('active', 'suspended', 'pending') DEFAULT 'active',
    avatar VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL
);

-- VIP Levels table
CREATE TABLE vip_levels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    level INT UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    min_deposit DECIMAL(15,2) NOT NULL,
    commission_rate DECIMAL(5,2) NOT NULL,
    daily_task_limit INT NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#8B5CF6'
);

-- Products table
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    image_url VARCHAR(500),
    category VARCHAR(100),
    commission_rate DECIMAL(5,2) DEFAULT 1.00,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table
CREATE TABLE tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    task_number INT NOT NULL,
    product_price DECIMAL(10,2) NOT NULL,
    commission_amount DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
    submitted_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Transactions table
CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('deposit', 'withdrawal', 'commission', 'refund') NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    description VARCHAR(255),
    reference_id INT DEFAULT NULL,
    status ENUM('pending', 'completed', 'rejected') DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Deposits table
CREATE TABLE deposits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'USDT',
    wallet_address VARCHAR(255),
    txn_hash VARCHAR(255),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Withdrawals table
CREATE TABLE withdrawals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    fee DECIMAL(10,2) DEFAULT 0.00,
    net_amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'USDT',
    wallet_address VARCHAR(255) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Admins table
CREATE TABLE admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('superadmin', 'admin', 'support') DEFAULT 'admin',
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Site settings table
CREATE TABLE settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- Default Data
-- ============================================

-- VIP Levels
INSERT INTO vip_levels (level, name, min_deposit, commission_rate, daily_task_limit, description, color) VALUES
(1, 'Bronze', 0, 1.00, 10, 'Starter level - 1% commission per task', '#CD7F32'),
(2, 'Silver', 100, 1.50, 20, 'Silver level - 1.5% commission per task', '#C0C0C0'),
(3, 'Gold', 500, 2.00, 30, 'Gold level - 2% commission per task', '#FFD700'),
(4, 'Platinum', 1000, 2.50, 50, 'Platinum level - 2.5% commission per task', '#E5E4E2'),
(5, 'Diamond', 5000, 3.00, 100, 'Diamond level - 3% commission per task', '#B9F2FF');

-- Sample Products
INSERT INTO products (name, description, price, image_url, category, commission_rate) VALUES
('Running Sneakers', 'Premium athletic running shoes with air cushion', 59.99, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400', 'Footwear', 1.50),
('Leather Backpack', 'Genuine leather business backpack with laptop compartment', 79.99, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400', 'Bags', 1.50),
('Wireless Earbuds', 'Active noise cancelling wireless earbuds 30hr battery', 89.99, 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400', 'Electronics', 2.00),
('Smart Watch', 'Health monitoring smartwatch with GPS tracking', 149.99, 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400', 'Electronics', 2.00),
('Yoga Mat', 'Non-slip premium yoga mat with carrying strap', 35.99, 'https://images.unsplash.com/photo-1601925228516-e1b9f39f1f4d?w=400', 'Sports', 1.00),
('Coffee Maker', 'Programmable drip coffee maker with thermal carafe', 65.99, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400', 'Kitchen', 1.50),
('Sunglasses', 'Polarized UV400 protection sunglasses', 45.99, 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400', 'Accessories', 1.00),
('Bluetooth Speaker', 'Waterproof portable bluetooth speaker 20W', 55.99, 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400', 'Electronics', 2.00),
('Skincare Set', 'Complete 5-step Korean skincare routine set', 49.99, 'https://images.unsplash.com/photo-1556228578-b2f3892d3c6a?w=400', 'Beauty', 1.50),
('Gaming Mouse', 'RGB gaming mouse 16000 DPI precision sensor', 39.99, 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=400', 'Electronics', 1.50),
('Silk Scarf', 'Pure silk hand-painted designer scarf', 29.99, 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=400', 'Fashion', 1.00),
('Fitness Band', 'Smart fitness tracker with heart rate monitor', 39.99, 'https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=400', 'Sports', 1.50);

-- Default admin (password: Admin@123)
INSERT INTO admins (username, email, password, role) VALUES
('admin', 'admin@investment.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'superadmin');

-- Default settings
INSERT INTO settings (setting_key, setting_value, description) VALUES
('site_name', 'InvestPro', 'Website name'),
('site_logo', '', 'Website logo URL'),
('min_deposit', '10', 'Minimum deposit amount'),
('min_withdrawal', '20', 'Minimum withdrawal amount'),
('withdrawal_fee', '2', 'Withdrawal fee percentage'),
('referral_bonus', '5', 'Referral bonus percentage'),
('maintenance_mode', 'false', 'Enable/disable maintenance mode'),
('usdt_wallet', 'TYour_USDT_Wallet_Address_Here', 'USDT TRC20 deposit address'),
('support_email', 'support@investment.com', 'Support email address'),
('support_telegram', '@investpro_support', 'Telegram support handle');
