const ecc = require('@bitcoinerlab/secp256k1');
const { ECPairFactory } = require('ecpair');
const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');

const ECPair = ECPairFactory(ecc);

class BitcoinTransactionEngine {
    constructor() {
        this.network = bitcoin.networks.bitcoin;
    }

    loadPrivateKey(wif) {
        try {
            return ECPair.fromWIF(wif, this.network);
        } catch (error) {
            throw new Error('Invalid private key: ' + error.message);
        }
    }

    deriveAddress(keyPair) {
        return bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: this.network }).address;
    }

    async fetchUTXOs(address) {
        // USE MAINNET ENDPOINTS - MULTIPLE FALLBACKS
        const endpoints = [
            { url: \https://mempool.space/api/address/\/utxo\, name: 'Mempool.space' },
            { url: \https://blockstream.info/api/address/\/utxo\, name: 'Blockstream.info' },
            { url: \https://api.blockcypher.com/v1/btc/main/addrs/\/full?limit=1000\, name: 'BlockCypher', transform: (data) => data.txrefs?.filter(tx => !tx.spent).map(tx => ({ txid: tx.tx_hash, vout: tx.tx_output_n, value: tx.value })) || [] },
            { url: \https://blockchain.info/unspent?active=\\, name: 'Blockchain.info', transform: (data) => data.unspent_outputs?.map(out => ({ txid: out.tx_hash_big_endian, vout: out.tx_output_n, value: out.value })) || [] }
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(\🔍 Fetching UTXOs from \...\);
                const res = await axios.get(endpoint.url, { timeout: 5000 });
                
                let utxos = [];
                if (endpoint.transform) {
                    utxos = endpoint.transform(res.data);
                } else {
                    utxos = res.data || [];
                }
                
                if (utxos.length > 0) {
                    console.log(\✅ Found \ UTXOs from \\);
                    return utxos;
                } else {
                    console.log(\ℹ️  No UTXOs found from \ (this is normal if address has zero balance)\);
                }
            } catch (error) {
                console.log(\⚠️  Failed to fetch from \: \\);
            }
        }
        
        return [];
    }

    async estimateFeeRate() {
        const feeEndpoints = [
            'https://mempool.space/api/v1/fees/recommended',
            'https://blockstream.info/api/fee-estimates',
            'https://api.blockcypher.com/v1/btc/main'
        ];

        for (const url of feeEndpoints) {
            try {
                const res = await axios.get(url, { timeout: 3000 });
                if (url.includes('mempool')) {
                    return res.data.fastestFee || 20;
                } else if (url.includes('blockstream')) {
                    const estimates = res.data;
                    return Math.max(...Object.values(estimates)) || 20;
                } else if (url.includes('blockcypher')) {
                    return res.data.high_fee_per_kb ? Math.ceil(res.data.high_fee_per_kb / 1000) : 20;
                }
            } catch (error) {
                console.log(\⚠️  Failed to fetch fee rate from \: \\);
            }
        }
        console.log('ℹ️  Using default fee rate: 20 sat/vB');
        return 20;
    }

    selectUTXOs(utxos, target, feeRate) {
        if (utxos.length === 0) {
            throw new Error(\No UTXOs found for address. Please ensure your address has sufficient Bitcoin balance.\);
        }

        let total = 0;
        const selected = [];
        const sorted = [...utxos].sort((a, b) => b.value - a.value);

        for (const utxo of sorted) {
            selected.push(utxo);
            total += utxo.value;
            if (total >= target + 1000) break;
        }

        if (total < target) {
            const needed = (target - total) / 100000000;
            throw new Error(\Insufficient funds. Need \ BTC more to complete transaction.\);
        }

        const change = total - target - Math.floor(180 * feeRate);
        return { selectedUtxos: selected, changeAmount: change > 5000 ? change : 0 };
    }

    async prepareTransaction(senderAddress, recipientAddress, amountBTC, feeRate) {
        const amountSats = Math.floor(amountBTC * 100000000);
        const finalFeeRate = feeRate || await this.estimateFeeRate();
        const utxos = await this.fetchUTXOs(senderAddress);
        
        const { selectedUtxos, changeAmount } = this.selectUTXOs(utxos, amountSats, finalFeeRate);

        return {
            inputs: selectedUtxos.map(utxo => ({
                txid: utxo.txid,
                vout: utxo.vout,
                value: utxo.value
            })),
            outputs: [
                { address: recipientAddress, value: amountSats }
            ],
            feeRate: finalFeeRate,
            senderAddress: senderAddress,
            changeAddress: changeAmount > 0 ? senderAddress : null,
            changeAmount: changeAmount
        };
    }

    async finalizeAndBroadcast(signedTxHex) {
        const psbt = bitcoin.Psbt.fromHex(signedTxHex, { network: this.network });
        psbt.finalizeAllInputs();
        const tx = psbt.extractTransaction();
        
        const endpoints = [
            { url: 'https://mempool.space/api/tx', name: 'Mempool.space' },
            { url: 'https://blockstream.info/api/tx', name: 'Blockstream.info' },
            { url: 'https://api.blockcypher.com/v1/btc/main/txs/push', name: 'BlockCypher', transform: (txHex) => ({ tx: txHex }) }
        ];

        for (const endpoint of endpoints) {
            try {
                console.log(\📡 Broadcasting via \...\);
                const config = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 5000
                };

                if (endpoint.name === 'BlockCypher') {
                    config.data = endpoint.transform(tx.toHex());
                    config.headers['Content-Type'] = 'application/json';
                } else {
                    config.data = tx.toHex();
                    config.headers['Content-Type'] = 'text/plain';
                }

                const res = await axios.post(endpoint.url, config.data, {
                    headers: config.headers,
                    timeout: config.timeout
                });

                let txid = '';
                if (typeof res.data === 'string') {
                    txid = res.data;
                } else if (res.data.txid) {
                    txid = res.data.txid;
                } else if (res.data.tx && res.data.tx.hash) {
                    txid = res.data.tx.hash;
                } else {
                    txid = tx.getId();
                }

                console.log(\✅ Successfully broadcast via \\);
                return txid;
            } catch (error) {
                console.log(\⚠️  Failed to broadcast via \: \\);
            }
        }
        throw new Error("All broadcast endpoints failed");
    }
}

module.exports = { BitcoinTransactionEngine };
