const axios = require('axios');

class TransactionBroadcaster {
    constructor() {
        this.endpoints = [
            'https://mempool.space/api/tx',
            'https://blockstream.info/api/tx'
        ];
    }

    async broadcast(txHex) {
        for (const endpoint of this.endpoints) {
            try {
                const res = await axios.post(endpoint, txHex, {
                    headers: { 'Content-Type': 'text/plain' }
                });
                return typeof res.data === 'string' ? res.data : res.data.txid;
            } catch {}
        }
        throw new Error("All broadcast endpoints failed");
    }
}

module.exports = { TransactionBroadcaster };
