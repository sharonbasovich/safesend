-include .env
export

ANVIL_RPC := http://127.0.0.1:8545
ANVIL_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

.PHONY: anvil deploy-local seed web test coverage fmt build-web deploy-base-sepolia verify-base-sepolia

anvil:            ## terminal 1 — local chain
	anvil --chain-id 31337

deploy-local:     ## terminal 2 — deploy SafeSend + MockUSDT + Poisoner to Anvil
	cd contracts && forge script script/Deploy.s.sol --rpc-url $(ANVIL_RPC) --broadcast --private-key $(ANVIL_KEY)

seed:             ## mint mUSDT, seed verified payee, set 60s cooldown
	cd scripts && npm install --silent && npm run seed

web:              ## terminal 3 — web app at http://localhost:5173/?demo=1
	cd web && npm install --silent && npm run dev

test:
	cd contracts && forge test -vvv

coverage:
	cd contracts && forge coverage

fmt:
	cd contracts && forge fmt --check

build-web:
	cd web && npm install && npm run build

deploy-base-sepolia:  ## requires PRIVATE_KEY in .env (throwaway testnet wallet only)
	@test -n "$(PRIVATE_KEY)" || (echo "PRIVATE_KEY is not set — put a throwaway testnet key in .env"; exit 1)
	cd contracts && forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --private-key $(PRIVATE_KEY)

verify-base-sepolia:  ## requires CONTRACT_ADDR and PRIVATE_KEY-free blockscout verification
	@test -n "$(CONTRACT_ADDR)" || (echo "CONTRACT_ADDR is not set"; exit 1)
	cd contracts && forge verify-contract $(CONTRACT_ADDR) src/SafeSend.sol:SafeSend --chain-id 84532 --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/
