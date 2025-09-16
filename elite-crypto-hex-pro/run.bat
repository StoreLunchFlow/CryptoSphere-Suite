@echo off
node --loader ts-node/esm src/cli/index.ts %*
