const readline = require('readline');
const { BitcoinTransactionEngine } = require('../core/bitcoinEngine');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// Safety confirmation function
async function confirmAction(message) {
    const response = await prompt(message + ' (yes/no): ');
    return response.toLowerCase() === 'yes' || response.toLowerCase() === 'y';
}

// Simple automatic send mode
(async () => {
    console.clear();
    console.log('=== ELITE CRYPTO HEX vOMEGA-PRO ===');
    console.log('MAINNET SEND MODE - REAL BITCOIN TRANSACTIONS');
    console.log('');
    console.log('⚠️  WARNING: This will send REAL BITCOIN transactions!');
    console.log('⚠️  Make sure you understand what you\'re doing.');
    console.log('');

    // Ask for sender address (no longer hardcoded)
    const senderAddress = await prompt('Your Bitcoin Address: ');
    
    console.log('');
    console.log('From: ' + senderAddress);
    console.log('');

    const recipient = await prompt('Recipient Address: ');
    const amountStr = await prompt('Amount (BTC): ');
    const amount = parseFloat(amountStr);

    if (!recipient || isNaN(amount) || amount <= 0) {
        console.error('ERROR: Invalid input. Aborted.');
        rl.close();
        process.exit(1);
    }

    // Safety confirmation
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
        const engine = new BitcoinTransactionEngine();
        
        console.log('');
        console.log('Preparing transaction...');
        const txData = await engine.prepareTransaction(senderAddress, recipient, amount);
        
        console.log('Amount: ' + amount + ' BTC');
        console.log('Estimated Fee Rate: ' + txData.feeRate + ' sat/vB');
        console.log('Total Input: ' + (txData.inputs.reduce((sum, input) => sum + input.value, 0) / 100000000).toFixed(8) + ' BTC');
        console.log('Change: ' + (txData.changeAmount > 0 ? (txData.changeAmount / 100000000).toFixed(8) + ' BTC' : 'None'));
        console.log('Inputs: ' + txData.inputs.length);
        console.log('Outputs: ' + (txData.outputs.length + (txData.changeAmount > 0 ? 1 : 0)));
        
        // Final safety confirmation with fee details
        console.log('');
        const totalCost = amount + (txData.changeAmount > 0 ? 0 : (txData.inputs.reduce((sum, input) => sum + input.value, 0) - amount * 100000000 - txData.changeAmount) / 100000000);
        console.log('Total Cost (including fees): ~' + totalCost.toFixed(8) + ' BTC');
        
        const finalConfirmed = await confirmAction('Final confirmation - proceed with transaction?');
        if (!finalConfirmed) {
            console.log('Transaction cancelled by user.');
            rl.close();
            process.exit(0);
        }

        // Simulate external signing
        console.log('');
        console.log('Signing transaction...');
        await new Promise(r => setTimeout(r, 1000));
        
        // Create mock signed transaction
        const bitcoin = require('bitcoinjs-lib');
        const ECPairFactory = require('ecpair').ECPairFactory;
        const ecc = require('@bitcoinerlab/secp256k1');
        const ECPair = ECPairFactory(ecc);
        
        // In real implementation, this would be signed by user's wallet
        // For demo, we'll simulate with a placeholder
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
        
        // In real implementation, signing would happen in user's wallet
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
        console.log('🔗 Track: https://mempool.space/tx/' + broadcastTxid);
        console.log('');
        console.log('🎉 Transaction broadcast successfully!');
        console.log('⏳ Wait for confirmations on the blockchain.');

    } catch (error) {
        console.error('');
        console.error('❌ ERROR: ' + error.message);
        console.error('Transaction failed. No funds were sent.');
    } finally {
        rl.close();
    }
})();
