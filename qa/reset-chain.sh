#!/usr/bin/env bash
# Fresh local Anvil + deploy + seed (mock money only)
set -e
export PATH=$HOME/.foundry/bin:$PATH
cd "$(dirname "$0")/.."
pkill -x anvil || true; sleep 1
nohup anvil --chain-id 31337 > /tmp/anvil.log 2>&1 &
sleep 2
make deploy-local > /tmp/deploy.log 2>&1
make seed 2>&1 | tail -1
cast call --rpc-url http://127.0.0.1:8545 0x5FbDB2315678afecb367f032d93F642f64180aa3 "nextId()(uint256)"
