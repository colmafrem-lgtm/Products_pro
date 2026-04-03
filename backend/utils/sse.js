// SSE (Server-Sent Events) manager
// Maps userId (string) → array of response objects

const clients = new Map();

// Admin connections (separate pool)
const adminClients = [];

function addAdminClient(res) {
    adminClients.push(res);
}

function removeAdminClient(res) {
    const i = adminClients.indexOf(res);
    if (i !== -1) adminClients.splice(i, 1);
}

function sendToAdmins(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (let i = adminClients.length - 1; i >= 0; i--) {
        try {
            adminClients[i].write(payload);
        } catch (err) {
            adminClients.splice(i, 1);
        }
    }
}

// Add a client connection for a user
function addClient(userId, res) {
    const key = String(userId);
    if (!clients.has(key)) {
        clients.set(key, []);
    }
    clients.get(key).push(res);
}

// Remove a client connection for a user
function removeClient(userId, res) {
    const key = String(userId);
    if (!clients.has(key)) return;
    const filtered = clients.get(key).filter(r => r !== res);
    if (filtered.length === 0) {
        clients.delete(key);
    } else {
        clients.set(key, filtered);
    }
}

// Send an SSE event to a specific user (all their open connections)
function sendToUser(userId, event, data) {
    const key = String(userId);
    if (!clients.has(key)) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients.get(key)) {
        try {
            res.write(payload);
        } catch (err) {
            // Connection already closed — ignore
        }
    }
}

// Broadcast an SSE event to ALL connected users
function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, connections] of clients) {
        for (const res of connections) {
            try {
                res.write(payload);
            } catch (err) {
                // Connection already closed — ignore
            }
        }
    }
}

// Heartbeat every 25 seconds to keep connections alive through proxies
setInterval(() => {
    for (const [, connections] of clients) {
        for (const res of connections) {
            try { res.write(': heartbeat\n\n'); } catch (err) {}
        }
    }
    for (let i = adminClients.length - 1; i >= 0; i--) {
        try { adminClients[i].write(': heartbeat\n\n'); } catch (err) { adminClients.splice(i, 1); }
    }
}, 25000);

module.exports = { addClient, removeClient, sendToUser, broadcast, addAdminClient, removeAdminClient, sendToAdmins };
