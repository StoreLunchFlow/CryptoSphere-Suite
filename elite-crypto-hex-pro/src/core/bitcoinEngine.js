const ecc = require('@bitcoinerlab/secp256k1');
const { ECPairFactory } = require('ecpair');
const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');

const ECPair = ECPairFactory(ecc);

class BitcoinTransactionEngine {
    constructor() {
        // SWITCH TO MAINNET
        this.network = bitcoin.networks.bitcoin;
    }

    // Keep existing methods for backward compatibility
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
        // USE MAINNET ENDPOINTS
        const endpoints = [
            'https://mempool.space/api/address/' + address + '/utxo',
            'https://blockstream.info/api/address/' + address + '/utxo'
        ];

        for (const url of endpoints) {
            try {
                const res = await axios.get(url);
                if (res.data?.length) return res.data;
            } catch {}
        }
        return [];
    }

    async estimateFeeRate() {
        try {
            const res = await axios.get('https://mempool.space/api/v1/fees/recommended');
            return res.data.fastestFee || 20;
        } catch {
            return 20;
        }
    }

    selectUTXOs(utxos, target, feeRate) {
        let total = 0;
        const selected = [];
        const sorted = [...utxos].sort((a, b) => b.value - a.value);

        for (const utxo of sorted) {
            selected.push(utxo);
            total += utxo.value;
            if (total >= target + 1000) break;
        }

        const change = total - target - Math.floor(180 * feeRate);
        return { selectedUtxos: selected, changeAmount: change > 5000 ? change : 0 };
    }

    // New method: prepare transaction data for external signing
    async prepareTransaction(senderAddress, recipientAddress, amountBTC, feeRate) {
        const amountSats = Math.floor(amountBTC * 100000000);
        const finalFeeRate = feeRate || await this.estimateFeeRate();
        const utxos = await this.fetchUTXOs(senderAddress);
        
        if (utxos.length === 0) throw new Error("No UTXOs found");

        const { selectedUtxos, changeAmount } = this.selectUTXOs(utxos, amountSats, finalFeeRate);

        // Return transaction data for external signing
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

    // New method: finalize and broadcast externally signed transaction
    async finalizeAndBroadcast(signedTxHex) {
        const psbt = bitcoin.Psbt.fromHex(signedTxHex, { network: this.network });
        psbt.finalizeAllInputs();
        const tx = psbt.extractTransaction();
        
        // Broadcast
        const endpoints = [
            'https://mempool.space/api/tx',
            'https://blockstream.info/api/tx'
        ];

        for (const endpoint of endpoints) {
            try {
                const res = await axios.post(endpoint, tx.toHex(), {
                    headers: { 'Content-Type': 'text/plain' }
                });
                return typeof res.data === 'string' ? res.data : res.data.txid;
            } catch {}
        }
        throw new Error("All broadcast endpoints failed");
    }
}

module.exports = { BitcoinTransactionEngine };
