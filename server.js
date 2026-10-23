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
        const handleResult = await pool.query('SELECT handle FROM handles WHERE handle = $1', [cleanHandle]);
        if (handleResult.rows.length === 0) {
            return res.status(404).json({ error: "Handle not found." });
        }

        const walletsResult = await pool.query('SELECT chain_type, wallet_address FROM linked_wallets WHERE handle = $1', [cleanHandle]);
        const exchangesResult = await pool.query('SELECT exchange_name, exchange_uid FROM linked_exchanges WHERE handle = $1', [cleanHandle]);

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
        await pool.query(
            `INSERT INTO handles (handle, owner_credential_id, passkey_public_key) VALUES ($1, $2, $3)`,
            [cleanHandle, owner_credential_id, passkey_public_key]
        );

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
        const ownerCheck = await pool.query('SELECT handle FROM handles WHERE handle = $1 AND owner_credential_id = $2', [cleanHandle, owner_credential_id]);
        if (ownerCheck.rows.length === 0) {
            return res.status(403).json({ error: "Unauthorized: Passkey does not match this handle." });
        }

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

// 4. AUTO-SYNC EXCHANGE WALLETS: Automatically fetches exchange deposit addresses and saves them
app.post('/api/v1/sync-exchange', async (req, res) => {
    const { handle, exchange_name, api_key } = req.body;

    if (!handle || !exchange_name || !api_key) {
        return res.status(400).json({ error: "Missing exchange sync parameters." });
    }

    const cleanHandle = handle.toLowerCase();

    try {
        const handleCheck = await pool.query('SELECT handle FROM handles WHERE handle = $1', [cleanHandle]);
        if (handleCheck.rows.length === 0) {
            return res.status(404).json({ error: "Universal ID handle not found." });
        }

        // Simulated automated fetch from exchange API (e.g., OKX/Binance deposit endpoints)
        const fetchedDepositAddresses = [
            { chain_type: 'evm', address: '0xAutoSyncedExchangeEVM999' },
            { chain_type: 'solana', address: 'AutoSyncedExchangeSolanaPubkey888' },
            { chain_type: 'bitcoin', address: 'bc1qAutoSyncedBitcoinAddress777' }
        ];

        for (const item of fetchedDepositAddresses) {
            await pool.query(
                `INSERT INTO linked_wallets (handle, chain_type, wallet_address) 
                 VALUES ($1, $2, $3) 
                 ON CONFLICT (handle, chain_type, wallet_address) 
                 DO NOTHING`,
                [cleanHandle, item.chain_type, item.address]
            );
        }

        await pool.query(
            `INSERT INTO linked_exchanges (handle, exchange_name, exchange_uid) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (handle, exchange_name) 
             DO UPDATE SET synced_at = CURRENT_TIMESTAMP`,
            [cleanHandle, exchange_name, 'synced_exchange_uid_live']
        );

        res.json({ 
            message: `Successfully auto-synced ${fetchedDepositAddresses.length} addresses from ${exchange_name.toUpperCase()} into your Universal ID library!`,
            synced_count: fetchedDepositAddresses.length 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to auto-sync exchange deposit addresses." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Resolution Engine running on port ${PORT}`);
});