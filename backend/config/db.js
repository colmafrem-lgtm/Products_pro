// SQLite via WebAssembly (sql.js) - no native compilation needed!
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, '../../database/investpro.db');

let sqliteDb = null; // will be set after init

// Save DB to file after every write
function saveDb() {
    if (!sqliteDb) return;
    const data = sqliteDb.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// Convert sql.js result → array of row objects
function toRows(result) {
    if (!result || result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map(row => {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
}

// Async query wrapper — mimics mysql2 pool.query() signature
const db = {
    query: async (sql, params = []) => {
        if (!sqliteDb) throw new Error('Database not initialized yet');

        // Fix MySQL-specific syntax → SQLite
        let q = sql
            .replace(/CURDATE\(\)/gi, "date('now')")
            .replace(/NOW\(\)/gi,    "datetime('now')")
            .replace(/RAND\(\)/gi,   "RANDOM()")
            .replace(/`/g, '"');

        const type = q.trimStart().substring(0, 6).toUpperCase();

        try {
            if (type === 'SELECT' || type === 'PRAGMA') {
                const result = sqliteDb.exec(q, params);
                return [toRows(result), []];
            } else if (type === 'INSERT') {
                sqliteDb.run(q, params);
                const lastId = sqliteDb.exec('SELECT last_insert_rowid() as id');
                const insertId = toRows(lastId)[0]?.id || 0;
                saveDb();
                return [{ insertId, affectedRows: sqliteDb.getRowsModified() }, []];
            } else {
                sqliteDb.run(q, params);
                const changed = sqliteDb.getRowsModified();
                saveDb();
                return [{ affectedRows: changed }, []];
            }
        } catch (err) {
            console.error('DB Error:', err.message);
            console.error('SQL:', q.substring(0, 300));
            throw err;
        }
    },

    // Expose raw db for init script
    _init: (db) => { sqliteDb = db; }
};

module.exports = db;
