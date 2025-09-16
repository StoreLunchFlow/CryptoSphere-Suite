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
        // USE MAINNET ENDPOINTS - INCLUDING MEMPOOL DATA
        const endpoints = [
            { 
                url: 'https://mempool.space/api/address/' + address + '/utxo', 
                name: 'Mempool.space',
                includeUnconfirmed: true
            },
            { 
                url: 'https://blockstream.info/api/address/' + address + '/utxo', 
                name: 'Blockstream.info',
                includeUnconfirmed: true
            },
            { 
                url: 'https://api.blockcypher.com/v1/btc/main/addrs/' + address + '/full?limit=1000', 
                name: 'BlockCypher', 
                includeUnconfirmed: true,
                transform: (data) => {
                    const allTxs = [...(data.txrefs || []), ...(data.unconfirmed_txrefs || [])];
                    return allTxs.filter(tx => !tx.spent).map(tx => ({ 
                        txid: tx.tx_hash, 
                        vout: tx.tx_output_n, 
                        value: tx.value,
                        status: tx.confirmed ? 'confirmed' : 'unconfirmed'
                    })) || [];
                }
            }
        ];

        for (const endpoint of endpoints) {
            try {
                console.log('🔍 Fetching UTXOs (including unconfirmed) from ' + endpoint.name + '...');
                const res = await axios.get(endpoint.url, { timeout: 5000 });
                
                let utxos = [];
                if (endpoint.transform) {
                    utxos = endpoint.transform(res.data);
                } else {
                    utxos = Array.isArray(res.data) ? res.data.map(utxo => ({
                        ...utxo,
                        status: utxo.status?.confirmed ? 'confirmed' : 'unconfirmed'
                    })) : [];
                }
                
                if (utxos.length > 0) {
                    const unconfirmedCount = utxos.filter(u => u.status === 'unconfirmed').length;
                    console.log('✅ Found ' + utxos.length + ' UTXOs (' + unconfirmedCount + ' unconfirmed) from ' + endpoint.name);
                    return utxos;
                } else {
                    console.log('ℹ️  No UTXOs found from ' + endpoint.name);
                }
            } catch (error) {
                console.log('⚠️  Failed to fetch from ' + endpoint.name + ': ' + error.message);
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
                    return res.data.fastestFee || 50; // Higher fee for unconfirmed chaining
                } else if (url.includes('blockstream')) {
                    const estimates = res.data;
                    return Math.max(...Object.values(estimates)) || 50;
                } else if (url.includes('blockcypher')) {
                    return res.data.high_fee_per_kb ? Math.ceil(res.data.high_fee_per_kb / 1000) : 50;
                }
            } catch (error) {
                console.log('⚠️  Failed to fetch fee rate from ' + url + ': ' + error.message);
            }
        }
        console.log('ℹ️  Using default fee rate: 50 sat/vB (higher for unconfirmed)');
        return 50;
    }

    selectUTXOs(utxos, target, feeRate) {
        if (utxos.length === 0) {
            throw new Error('No UTXOs found for address. Please ensure your address has sufficient Bitcoin balance (confirmed or unconfirmed).');
        }

        // Sort by value (descending) but don't exclude unconfirmed
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
            throw new Error('Insufficient funds. Need ' + needed.toFixed(8) + ' BTC more to complete transaction.');
        }

        // Use higher fee for transactions spending unconfirmed inputs
        const hasUnconfirmedInputs = selected.some(utxo => utxo.status === 'unconfirmed');
        const effectiveFeeRate = hasUnconfirmedInputs ? Math.max(feeRate, 50) : feeRate;
        
        const change = total - target - Math.floor(180 * effectiveFeeRate);
        return { 
            selectedUtxos: selected, 
            changeAmount: change > 5000 ? change : 0,
            hasUnconfirmedInputs: hasUnconfirmedInputs,
            feeRate: effectiveFeeRate
        };
    }

    async prepareTransaction(senderAddress, recipientAddress, amountBTC, feeRate) {
        const amountSats = Math.floor(amountBTC * 100000000);
        const finalFeeRate = feeRate || await this.estimateFeeRate();
        const utxos = await this.fetchUTXOs(senderAddress);
        
        const { selectedUtxos, changeAmount, hasUnconfirmedInputs, feeRate: effectiveFeeRate } = this.selectUTXOs(utxos, amountSats, finalFeeRate);

        return {
            inputs: selectedUtxos.map(utxo => ({
                txid: utxo.txid,
                vout: utxo.vout,
                value: utxo.value,
                status: utxo.status
            })),
            outputs: [
                { address: recipientAddress, value: amountSats }
            ],
            feeRate: effectiveFeeRate,
            senderAddress: senderAddress,
            changeAddress: changeAmount > 0 ? senderAddress : null,
            changeAmount: changeAmount,
            hasUnconfirmedInputs: hasUnconfirmedInputs
        };
    }

    async finalizeAndBroadcast(signedTxHex) {
        const psbt = bitcoin.Psbt.fromHex(signedTxHex, { network: this.network });
        psbt.finalizeAllInputs();
        const tx = psbt.extractTransaction();
        
        const endpoints = [
            { url: 'https://mempool.space/api/tx', name: 'Mempool.space' },
            { url: 'https://blockstream.info/api/tx', name: 'Blockstream.info' },
            { url: 'https://api.blockchain.com/v3/blockchain/transactions', name: 'Blockchain.com', transform: (txHex) => ({ hex: txHex }) }
        ];

        for (const endpoint of endpoints) {
            try {
                console.log('📡 Broadcasting via ' + endpoint.name + '...');
                let config = {
                    method: 'POST',
                    timeout: 5000
                };

                if (endpoint.name === 'Blockchain.com') {
                    config.headers = { 'Content-Type': 'application/json' };
                    config.data = endpoint.transform(tx.toHex());
                } else {
                    config.headers = { 'Content-Type': 'text/plain' };
                    config.data = tx.toHex();
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
                } else if (res.data.hash) {
                    txid = res.data.hash;
                } else {
                    txid = tx.getId();
                }

                console.log('✅ Successfully broadcast via ' + endpoint.name);
                return txid;
            } catch (error) {
                console.log('⚠️  Failed to broadcast via ' + endpoint.name + ': ' + error.message);
            }
        }
        throw new Error("All broadcast endpoints failed");
    }
}

module.exports = { BitcoinTransactionEngine };
