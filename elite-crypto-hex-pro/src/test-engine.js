const { BitcoinTransactionEngine } = require('./core/bitcoinEngine');
console.log('✅ BitcoinTransactionEngine loaded successfully');
const engine = new BitcoinTransactionEngine();
console.log('✅ Instance created successfully');
process.exit(0);
