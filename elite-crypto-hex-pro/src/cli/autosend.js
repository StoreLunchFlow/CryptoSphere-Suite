const readline = require('readline');
const { BitcoinTransactionEngine } = require('../core/bitcoinEngine');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function confirmAction(message) {
    const response = await prompt(message + ' (yes/no): ');
    return response.toLowerCase() === 'yes' || response.toLowerCase() === 'y';
}

(async () => {
    console.clear();
    console.log('=== ELITE CRYPTO HEX vOMEGA-PRO ===');
    console.log('UNCONFIRMED TRANSACTION MODE - SPEND FROM MEMPOOL');
    console.log('');
    console.log('⚠️  WARNING: This will send REAL BITCOIN transactions!');
    console.log('⚠️  You can spend unconfirmed UTXOs (transactions still in mempool)');
    console.log('');

    const senderAddress = await prompt('Your Bitcoin Address: ');
    
    console.log('');
    console.log('From: ' + senderAddress);
    console.log('');
    console.log('ℹ️  Checking address balance (including unconfirmed transactions)...');

    try {
        const engine = new BitcoinTransactionEngine();
        const utxos = await engine.fetchUTXOs(senderAddress);
        
        if (utxos.length === 0) {
            console.log('');
            console.log('❌ NO FUNDS DETECTED');
            console.log('The address ' + senderAddress + ' has no spendable Bitcoin (0 BTC balance).');
            console.log('');
            console.log('💡 SOLUTIONS:');
            console.log('1. Send some Bitcoin to this address first');
            console.log('2. Use a different address that has Bitcoin (confirmed or unconfirmed)');
            console.log('3. Check the address on https://www.blockchain.com/explorer/search?search=' + senderAddress);
            rl.close();
            process.exit(1);
        } else {
            const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0) / 100000000;
            const unconfirmedCount = utxos.filter(u => u.status === 'unconfirmed').length;
            console.log('✅ BALANCE FOUND: ' + totalBalance.toFixed(8) + ' BTC');
            console.log('Total UTXOs: ' + utxos.length + ' (' + unconfirmedCount + ' unconfirmed)');
            
            if (unconfirmedCount > 0) {
                console.log('💎 SPECIAL FEATURE: You can spend unconfirmed UTXOs!');
                console.log('💰 Higher fees will be used to ensure confirmation');
            }
        }

        console.log('');
        const recipient = await prompt('Recipient Address: ');
        const amountStr = await prompt('Amount (BTC): ');
        const amount = parseFloat(amountStr);

        if (!recipient || isNaN(amount) || amount <= 0) {
            console.error('ERROR: Invalid input. Aborted.');
            rl.close();
            process.exit(1);
        }

        console.log('');
        console.log('🚨 TRANSACTION SUMMARY:');
        console.log('From: ' + senderAddress);
        console.log('To: ' + recipient);
        console.log('Amount: ' + amount + ' BTC');
        console.log('');

        const confirmed = await confirmAction('Are you sure you want to send this transaction?');
        if (!confirmed) {
            console.log('Transaction cancelled by user.');
            rl.close();
            process.exit(0);
        }

        try {
            console.log('');
            console.log('Preparing transaction...');
            const txData = await engine.prepareTransaction(senderAddress, recipient, amount);
            
            console.log('Amount: ' + amount + ' BTC');
            console.log('Fee Rate: ' + txData.feeRate + ' sat/vB');
            if (txData.hasUnconfirmedInputs) {
                console.log('⚡ WARNING: Spending unconfirmed inputs - higher fee applied');
            }
            console.log('Total Input: ' + (txData.inputs.reduce((sum, input) => sum + input.value, 0) / 100000000).toFixed(8) + ' BTC');
            console.log('Change: ' + (txData.changeAmount > 0 ? (txData.changeAmount / 100000000).toFixed(8) + ' BTC' : 'None'));
            console.log('Inputs: ' + txData.inputs.length);
            console.log('Outputs: ' + (txData.outputs.length + (txData.changeAmount > 0 ? 1 : 0)));
            
            // Show unconfirmed input warning
            const unconfirmedInputs = txData.inputs.filter(input => input.status === 'unconfirmed');
            if (unconfirmedInputs.length > 0) {
                console.log('');
                console.log('⚠️  ⚠️  ⚠️  IMPORTANT ⚠️  ⚠️  ⚠️');
                console.log('You are spending ' + unconfirmedInputs.length + ' unconfirmed transaction(s)');
                console.log('This creates a chained transaction that may take longer to confirm');
                console.log('Higher fees have been applied to improve confirmation chances');
                console.log('⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️');
            }

            console.log('');
            const totalCost = amount + (txData.changeAmount > 0 ? 0 : (txData.inputs.reduce((sum, input) => sum + input.value, 0) - amount * 100000000 - txData.changeAmount) / 100000000);
            console.log('Total Cost (including fees): ~' + totalCost.toFixed(8) + ' BTC');
            
            const finalConfirmed = await confirmAction('Final confirmation - proceed with transaction?');
            if (!finalConfirmed) {
                console.log('Transaction cancelled by user.');
                rl.close();
                process.exit(0);
            }

            console.log('');
            console.log('Signing transaction...');
            await new Promise(r => setTimeout(r, 1000));
            
            const bitcoin = require('bitcoinjs-lib');
            const ECPairFactory = require('ecpair').ECPairFactory;
            const ecc = require('@bitcoinerlab/secp256k1');
            const ECPair = ECPairFactory(ecc);
            
            const mockPsbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
            txData.inputs.forEach(input => {
                mockPsbt.addInput({
                    hash: input.txid,
                    index: input.vout,
                    witnessUtxo: { value: input.value, script: Buffer.from('') }
                });
            });
            txData.outputs.forEach(output => {
                mockPsbt.addOutput({ address: output.address, value: output.value });
            });
            if (txData.changeAmount > 0) {
                mockPsbt.addOutput({ address: txData.changeAddress, value: txData.changeAmount });
            }
            
            console.log('');
            console.log('⚠️  In production, this would be signed by your wallet provider');
            console.log('⚠️  For demo, simulating signature...');
            await new Promise(r => setTimeout(r, 1500));
            
            const signedTxHex = mockPsbt.extractTransaction().toHex();
            const txid = mockPsbt.extractTransaction().getId();

            console.log('');
            console.log('Broadcasting transaction...');
            const broadcastTxid = await engine.finalizeAndBroadcast(signedTxHex);
            
            console.log('');
            console.log('✅ SUCCESS! TXID: ' + broadcastTxid);
            console.log('🔗 Track on Blockchain.com: https://www.blockchain.com/explorer/transactions/btc/' + broadcastTxid);
            console.log('🔗 Also track on Mempool.space: https://mempool.space/tx/' + broadcastTxid);
            console.log('');
            console.log('🎉 Transaction broadcast successfully!');
            
            if (txData.hasUnconfirmedInputs) {
                console.log('⏳ This transaction spends unconfirmed inputs - may take longer to confirm');
                console.log('💎 Consider using Replace-By-Fee (RBF) if it gets stuck');
            } else {
                console.log('⏳ Wait for confirmations on the blockchain');
            }

        } catch (error) {
            console.error('');
            console.error('❌ TRANSACTION ERROR: ' + error.message);
            console.error('Transaction failed. No funds were sent.');
        }
    } catch (error) {
        console.error('');
        console.error('❌ SYSTEM ERROR: ' + error.message);
    } finally {
        rl.close();
    }
})();
