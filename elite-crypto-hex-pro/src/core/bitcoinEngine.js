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
        } catch {
            throw new Error('Invalid private key');
        }
    }

    deriveAddress(keyPair) {
        return bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: this.network }).address;
    }

    async fetchUTXOs(address) {
        const endpoints = [
            \https://mempool.space/api/address/\/utxo\,
            \https://blockstream.info/api/address/\/utxo\
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

    async buildAndSignTransaction(privateKeyWIF, recipientAddress, amountBTC, feeRate) {
        const keyPair = this.loadPrivateKey(privateKeyWIF);
        const senderAddress = this.deriveAddress(keyPair);
        const amountSats = Math.floor(amountBTC * 100000000);

        const finalFeeRate = feeRate || await this.estimateFeeRate();
        const utxos = await this.fetchUTXOs(senderAddress);
        if (utxos.length === 0) throw new Error("No UTXOs found");

        const { selectedUtxos, changeAmount } = this.selectUTXOs(utxos, amountSats, finalFeeRate);

        const psbt = new bitcoin.Psbt({ network: this.network });
        selectedUtxos.forEach(utxo => {
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                witnessUtxo: {
                    value: utxo.value,
                    script: Buffer.from('')
                }
            });
        });

        psbt.addOutput({
            address: recipientAddress,
            value: amountSats
        });

        if (changeAmount > 0) {
            psbt.addOutput({
                address: senderAddress,
                value: changeAmount
            });
        }

        psbt.signAllInputs(keyPair);
        psbt.finalizeAllInputs();

        const tx = psbt.extractTransaction();
        return { txHex: tx.toHex(), txid: tx.getId() };
    }
}

module.exports = { BitcoinTransactionEngine };
