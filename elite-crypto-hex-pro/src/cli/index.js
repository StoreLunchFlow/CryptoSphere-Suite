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
    console.log('=== ELITE CRYPTO HEX vOMEGA-PRO ===');
    console.log('CLI MODE - ENTER CREDENTIALS BELOW');

    const privateKey = await prompt('Private Key (WIF): ');
    const recipient = await prompt('Recipient Address: ');
    const amountStr = await prompt('Amount (BTC): ');
    const amount = parseFloat(amountStr);

    if (!privateKey || !recipient || isNaN(amount)) {
        console.error('ERROR: Invalid input. Aborted.');
        rl.close();
        process.exit(1);
    }

    try {
        const engine = new BitcoinTransactionEngine();
        const broadcaster = new TransactionBroadcaster();

        console.log('Building transaction...');
        const { txHex, txid } = await engine.buildAndSignTransaction(privateKey, recipient, amount);

        console.log('TXID: ' + txid);
        console.log('Broadcasting to nodes...');

        const broadcastTxid = await broadcaster.broadcast(txHex);
        console.log('SUCCESS! TXID: ' + broadcastTxid);
        console.log('Track: https://mempool.space/tx/' + broadcastTxid);

    } catch (error) {
        console.error('ERROR: ' + error.message);
    } finally {
        rl.close();
    }
})();
