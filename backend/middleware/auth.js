const jwt = require('jsonwebtoken');
require('dotenv').config();

// Middleware: Verify user JWT token
const authenticateUser = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Allow token via query param only for SSE endpoint (EventSource cannot send headers)
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (!token && req.path.endsWith('/events') && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
};

// Middleware: Verify admin JWT token
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];
    if (!token && req.path.endsWith('/events') && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Admin access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired admin token.' });
    }
};

// Middleware: Check if admin is superadmin
const requireSuperAdmin = (req, res, next) => {
    if (req.admin.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Super admin access required.' });
    }
    next();
};

module.exports = { authenticateUser, authenticateAdmin, requireSuperAdmin };
