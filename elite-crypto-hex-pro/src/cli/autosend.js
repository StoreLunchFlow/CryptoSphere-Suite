const readline = require('readline');
const { BitcoinTransactionEngine } = require('../core/bitcoinEngine');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// Simple automatic send mode
(async () => {
    console.clear();
    console.log('=== ELITE CRYPTO HEX vOMEGA-PRO ===');
    console.log('SIMPLIFIED SEND MODE - JUST ADDRESS + AMOUNT\n');

    // Hardcoded testnet address for demo
    const senderAddress = 'tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    console.log(📤 From: );

    const recipient = await prompt('\nRecipient Address: ');
    const amountStr = await prompt('Amount (BTC): ');
    const amount = parseFloat(amountStr);

    if (!recipient || isNaN(amount) || amount <= 0) {
        console.error('ERROR: Invalid input. Aborted.');
        rl.close();
        process.exit(1);
    }

    try {
        const engine = new BitcoinTransactionEngine();
        
        console.log('\n⏳ Preparing transaction...');
        const txData = await engine.prepareTransaction(senderAddress, recipient, amount);
        
        console.log('💰 Amount: ' + amount + ' BTC');
        console.log('📥 Inputs: ' + txData.inputs.length);
        console.log('📤 Outputs: ' + txData.outputs.length);
        
        // Simulate external signing
        console.log('\n✍️  Simulating wallet signature...');
        await new Promise(r => setTimeout(r, 1500));
        
        // Create mock signed transaction
        const mockPsbt = new (require('bitcoinjs-lib')).Psbt({ network: require('bitcoinjs-lib').networks.testnet });
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
        
        // Mock signing
        const mockKeyPair = require('ecpair').ECPairFactory(require('@bitcoinerlab/secp256k1')).fromWIF('cVt4o7BGAig1UXywgGSmARhxMdzP5qvQsxKkSsc1XEkw3tDTQFpy', require('bitcoinjs-lib').networks.testnet);
        mockPsbt.signAllInputs(mockKeyPair);
        mockPsbt.finalizeAllInputs();
        
        const signedTxHex = mockPsbt.extractTransaction().toHex();
        const txid = mockPsbt.extractTransaction().getId();

        console.log('\n📡 Broadcasting transaction...');
        const broadcastTxid = await engine.finalizeAndBroadcast(signedTxHex);
        
        console.log('\n✅ SUCCESS! TXID: ' + broadcastTxid);
        console.log('🔗 Track: https://mempool.space/testnet/tx/' + broadcastTxid);

    } catch (error) {
        console.error('\n❌ ERROR: ' + error.message);
    } finally {
        rl.close();
    }
})();
