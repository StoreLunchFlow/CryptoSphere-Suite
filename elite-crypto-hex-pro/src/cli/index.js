const readline = require('readline');
const { BitcoinTransactionEngine } = require('../core/bitcoinEngine');
const { TransactionBroadcaster } = require('../services/broadcaster');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

(async () => {
    console.clear();
    console.log('\x1b[35m🚀 ELITE CRYPTO HEX vΩ-PRO — CLI MODE\x1b[0m');
    console.log('\x1b[33m⚡ ENTER CREDENTIALS TO INITIATE TRANSACTION\x1b[0m\n');

    const privateKey = await prompt('🔑 Private Key (WIF): ');
    const recipient = await prompt('💎 Recipient Address: ');
    const amountStr = await prompt('💰 Amount (BTC): ');
    const amount = parseFloat(amountStr);

    if (!privateKey || !recipient || isNaN(amount)) {
        console.error('\x1b[31m❌ Invalid input. Aborted.\x1b[0m');
        rl.close();
        process.exit(1);
    }

    try {
        const engine = new BitcoinTransactionEngine();
        const broadcaster = new TransactionBroadcaster();

        console.log('\x1b[36m⏳ Building transaction...\x1b[0m');
        const { txHex, txid } = await engine.buildAndSignTransaction(privateKey, recipient, amount);

        console.log(\x1b[32m🧾 TXID: \x1b[0m);
        console.log('\x1b[36m📡 Broadcasting to nodes...\x1b[0m');

        const broadcastTxid = await broadcaster.broadcast(txHex);
        console.log(\x1b[32m✅ SUCCESS! TXID: \x1b[0m);
        console.log(🔗 Track: https://mempool.space/tx/);

    } catch (error) {
        console.error(\x1b[31m❌ Error: \x1b[0m);
    } finally {
        rl.close();
    }
})();

