const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serves index.html directly from the root directory

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// RESOLUTION ENDPOINT: Used by exchange widgets to resolve handles
app.get('/api/v1/resolve', async (req, res) => {
    const handle = req.query.handle;
    if (!handle) {
        return res.status(400).json({ error: "Handle parameter is required." });
    }

    try {
        const query = 'SELECT handle, evm_address, solana_address, okx_uid FROM handles WHERE handle = $1';
        const result = await pool.query(query, [handle.toLowerCase().replace('@', '')]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Handle not found." });
        }

        const row = result.rows[0];
        res.json({
            handle: row.handle,
            destinations: {
                evm: row.evm_address,
                solana: row.solana_address,
                okx_uid: row.okx_uid
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database lookup failed." });
    }
});

// REGISTRATION ENDPOINT: Claims handle with Passkey metadata and wallet mappings
app.post('/api/v1/register', async (req, res) => {
    const { handle, owner_credential_id, passkey_public_key, evm_address, solana_address, okx_uid } = req.body;

    if (!handle || !owner_credential_id) {
        return res.status(400).json({ error: "Handle and Passkey credential ID are required." });
    }

    try {
        const query = `
            INSERT INTO handles (handle, owner_credential_id, passkey_public_key, evm_address, solana_address, okx_uid)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING handle;
        `;
        const values = [handle.toLowerCase(), owner_credential_id, passkey_public_key, evm_address, solana_address, okx_uid];
        await pool.query(query, values);

        res.status(201).json({ message: "Handle registered successfully!", handle: handle.toLowerCase() });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: "Handle already claimed by another passkey." });
        }
        console.error(err);
        res.status(500).json({ error: "Database registration error." });
    }
});

// START SERVER AT THE VERY BOTTOM
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Resolution Engine running on port ${PORT}`);
});