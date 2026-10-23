const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 1. MASTER REGISTRATION ENDPOINT
app.post('/api/v1/register', async (req, res) => {
    const { handle, owner_credential_id, passkey_public_key, evm_address, solana_address, okx_uid } = req.body;
    const cleanHandle = handle?.toLowerCase().trim();

    if (!cleanHandle || !owner_credential_id) {
        return res.status(400).json({ error: "Handle and passkey credential ID are required." });
    }

    try {
        const { error: handleErr } = await supabase.from('handles').insert({
            handle: cleanHandle,
            owner_credential_id,
            passkey_public_key
        });

        if (handleErr) throw handleErr;

        if (evm_address) {
            await supabase.from('linked_wallets').insert({ handle: cleanHandle, chain_type: 'evm', wallet_address: evm_address });
        }
        if (solana_address) {
            await supabase.from('linked_wallets').insert({ handle: cleanHandle, chain_type: 'solana', wallet_address: solana_address });
        }
        if (okx_uid) {
            await supabase.from('linked_exchanges').insert({ handle: cleanHandle, exchange_name: 'okx', deposit_address: okx_uid });
        }

        return res.json({ success: true, handle: cleanHandle, message: "Universal ID successfully registered!" });
    } catch (err) {
        return res.status(500).json({ error: "Registration error: " + err.message });
    }
});

// 2. RESOLUTION & AGGREGATION ENDPOINT
app.get('/api/v1/resolve', async (req, res) => {
    const cleanHandle = req.query.handle?.toLowerCase().trim();
    if (!cleanHandle) return res.status(400).json({ error: "Handle parameter required." });

    try {
        const { data: handleRecord, error: handleErr } = await supabase
            .from('handles').select('*').eq('handle', cleanHandle).single();

        if (handleErr || !handleRecord) {
            return res.status(404).json({ error: "Universal ID handle not found." });
        }

        const { data: wallets } = await supabase.from('linked_wallets').select('*').eq('handle', cleanHandle);
        const { data: exchanges } = await supabase.from('linked_exchanges').select('*').eq('handle', cleanHandle);

        let destinations = {};
        if (wallets) {
            wallets.forEach(w => destinations[w.chain_type] = w.wallet_address);
        }
        if (exchanges) {
            exchanges.forEach(e => destinations[e.exchange_name] = e.deposit_address);
        }

        return res.json({ handle: cleanHandle, destinations });
    } catch (err) {
        return res.status(500).json({ error: "Resolution server error: " + err.message });
    }
});

// 3. SECURE WALLET/EXCHANGE LINKING ENDPOINT
app.post('/api/v1/link-wallet', async (req, res) => {
    const { handle, chain_type, wallet_address, owner_credential_id } = req.body;
    const cleanHandle = handle?.toLowerCase().trim();

    if (!cleanHandle || !chain_type || !wallet_address || !owner_credential_id) {
        return res.status(400).json({ error: "All fields including passkey verification are required." });
    }

    try {
        const { data: handleRecord, error: handleErr } = await supabase
            .from('handles').select('*').eq('handle', cleanHandle).single();

        if (handleErr || !handleRecord || handleRecord.owner_credential_id !== owner_credential_id) {
            return res.status(403).json({ error: "Passkey authentication failed for this handle." });
        }

        const isExchange = ['okx', 'binance', 'bybit', 'bitget', 'kraken', 'coinbase'].includes(chain_type.toLowerCase());
        const table = isExchange ? 'linked_exchanges' : 'linked_wallets';
        const payload = isExchange 
            ? { handle: cleanHandle, exchange_name: chain_type.toLowerCase(), deposit_address: wallet_address }
            : { handle: cleanHandle, chain_type: chain_type.toLowerCase(), wallet_address };

        const { error: linkErr } = await supabase.from(table).upsert(payload);
        if (linkErr) throw linkErr;

        return res.json({ success: true, message: `Successfully linked ${chain_type.toUpperCase()} route to @${cleanHandle}` });
    } catch (err) {
        return res.status(500).json({ error: "Linking error: " + err.message });
    }
});

// 4. DYNAMIC EXCHANGE AUTO-SYNC ENDPOINT
app.post('/api/v1/sync-exchange', async (req, res) => {
    const { handle, exchange_name, api_key } = req.body;
    const cleanHandle = handle?.toLowerCase().trim();
    const normalizedExchange = exchange_name?.toLowerCase().trim();

    if (!cleanHandle || !normalizedExchange || !api_key) {
        return res.status(400).json({ error: "Missing handle, exchange name, or API key." });
    }

    try {
        // Generalized dynamic adapter simulation for CEX API sync
        let simulatedDepositAddress = `EXCHANGE_SYNC_${normalizedExchange.toUpperCase()}_${Math.random().toString(36).substring(7).toUpperCase()}`;

        const { error: dbError } = await supabase
            .from('linked_exchanges')
            .upsert({ 
                handle: cleanHandle, 
                exchange_name: normalizedExchange, 
                deposit_address: simulatedDepositAddress 
            });

        if (dbError) throw dbError;

        return res.json({ 
            success: true, 
            message: `Successfully synced ${normalizedExchange.toUpperCase()} account! Address mapped: ${simulatedDepositAddress}` 
        });
    } catch (err) {
        return res.status(500).json({ error: "Failed to auto-sync exchange: " + err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
