const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cors());

// Supabase PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// RESOLUTION ENDPOINT: Used by exchange widgets to resolve handles
app.get('/api/v1/resolve', async (req, res) => {
  const { handle } = req.query;

  if (!handle) {
    return res.status(400).json({ error: "Handle query parameter is required." });
  }

  try {
    const query = 'SELECT handle, evm_address, solana_address, tron_address, okx_uid, kucoin_uid FROM handles WHERE handle = $1';
    const result = await pool.query(query, [handle.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Handle not found." });
    }

    const row = result.rows[0];
    return res.json({
      success: true,
      handle: row.handle,
      destinations: {
        evm: row.evm_address,
        solana: row.solana_address,
        tron: row.tron_address,
        okx_uid: row.okx_uid,
        kucoin_uid: row.kucoin_uid
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database lookup failed." });
  }
});

// REGISTRATION ENDPOINT: Registers new handles linked to Passkey credentials
app.post('/api/v1/register', async (req, res) => {
  const { handle, credentialId, publicKey, evmAddress, solanaAddress, tronAddress, okxUid, kucoinUid } = req.body;

  if (!handle || !credentialId || !publicKey) {
    return res.status(400).json({ error: "Missing required passkey parameters." });
  }

  try {
    const insertQuery = `
      INSERT INTO handles (handle, owner_credential_id, passkey_public_key, evm_address, solana_address, tron_address, okx_uid, kucoin_uid)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING handle;
    `;
    
    const values = [
      handle.toLowerCase(), 
      credentialId, 
      publicKey, 
      evmAddress || null, 
      solanaAddress || null, 
      tronAddress || null, 
      okxUid || null, 
      kucoinUid || null
    ];

    const newHandle = await pool.query(insertQuery, values);

    return res.status(201).json({
      success: true,
      message: `Handle ${newHandle.rows[0].handle} registered successfully!`
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: "Handle already exists." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create handle." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Resolution Engine running on port ${PORT}`);
});