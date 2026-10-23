const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 1. RESOLUTION ENDPOINT: Aggregates all linked wallets & exchanges for a handle
app.get('/api/v1/resolve', async (req, res) => {
    const handleQuery = req.query.handle;
    if (!handleQuery) {
        return res.status(400).json({ error: "Handle parameter is required." });
    }

    const cleanHandle = handleQuery.toLowerCase().replace('@', '');

    try {
        // Fetch master handle check
        const handleResult = await pool.query('SELECT handle FROM handles WHERE handle = $1', [cleanHandle]);
        if (handleResult.rows.length === 0) {
            return res.status(404).json({ error: "Handle not found." });
        }

        // Fetch all linked wallets
        const walletsResult = await pool.query('SELECT chain_type, wallet_address FROM linked_wallets WHERE handle = $1', [cleanHandle]);
        
        // Fetch all linked exchanges
        const exchangesResult = await pool.query('SELECT exchange_name, exchange_uid FROM linked_exchanges WHERE handle = $1', [cleanHandle]);

        // Format destinations object dynamically
        const destinations = {};
        walletsResult.rows.forEach(w => {
            destinations[w.chain_type] = w.wallet_address;
        });
        exchangesResult.rows.forEach(e => {
            destinations[`${e.exchange_name}_uid`] = e.exchange_uid;
        });

        res.json({
            handle: cleanHandle,
            destinations: destinations
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database lookup failed." });
    }
});

// 2. REGISTRATION ENDPOINT: Creates master handle with Passkey
app.post('/api/v1/register', async (req, res) => {
    const { handle, owner_credential_id, passkey_public_key, evm_address, solana_address, okx_uid } = req.body;

    if (!handle || !owner_credential_id) {
        return res.status(400).json({ error: "Handle and Passkey credential ID are required." });
    }

    const cleanHandle = handle.toLowerCase();

    try {
        // Insert Master Handle
        await pool.query(
            `INSERT INTO handles (handle, owner_credential_id, passkey_public_key) VALUES ($1, $2, $3)`,
            [cleanHandle, owner_credential_id, passkey_public_key]
        );

        // If optional initial wallets/exchanges were passed, insert them into child tables
        if (evm_address) {
            await pool.query(`INSERT INTO linked_wallets (handle, chain_type, wallet_address, is_primary) VALUES ($1, 'evm', $2, true)`, [cleanHandle, evm_address]);
        }
        if (solana_address) {
            await pool.query(`INSERT INTO linked_wallets (handle, chain_type, wallet_address, is_primary) VALUES ($1, 'solana', $2, true)`, [cleanHandle, solana_address]);
        }
        if (okx_uid) {
            await pool.query(`INSERT INTO linked_exchanges (handle, exchange_name, exchange_uid) VALUES ($1, 'okx', $2)`, [cleanHandle, okx_uid]);
        }

        res.status(201).json({ message: "Universal ID registered successfully!", handle: cleanHandle });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: "Handle already claimed by another passkey." });
        }
        console.error(err);
        res.status(500).json({ error: "Database registration error." });
    }
});

// 3. LINK WALLET ENDPOINT: Adds new wallets to an existing Universal ID
app.post('/api/v1/link-wallet', async (req, res) => {
    const { handle, chain_type, wallet_address, owner_credential_id } = req.body;

    if (!handle || !chain_type || !wallet_address || !owner_credential_id) {
        return res.status(400).json({ error: "Missing required fields for linking wallet." });
    }

    const cleanHandle = handle.toLowerCase();

    try {
        // Verify ownership via Passkey credential ID
        const ownerCheck = await pool.query('SELECT handle FROM handles WHERE handle = $1 AND owner_credential_id = $2', [cleanHandle, owner_credential_id]);
        if (ownerCheck.rows.length === 0) {
            return res.status(403).json({ error: "Unauthorized: Passkey does not match this handle." });
        }

        // Insert new wallet address
        await pool.query(
            `INSERT INTO linked_wallets (handle, chain_type, wallet_address) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [cleanHandle, chain_type, wallet_address]
        );

        res.json({ message: `Successfully linked ${chain_type} address to @${cleanHandle}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to link wallet." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Resolution Engine running on port ${PORT}`);
});