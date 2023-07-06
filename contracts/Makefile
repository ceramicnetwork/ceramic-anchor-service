DEFAULT_BALANCE=900000000000000000
HARDFORK=london
FUNC=owner()
CONTRACT_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
CHAIN_ID=1337

ifneq (,$(wildcard ../.env))
	include ../.env
	export
endif

ifneq (,$(NODE_ENV))
	ifneq (,$(wildcard ../.env.${NODE_ENV}))
		include ../.env.${NODE_ENV}
		export
	endif
endif


SHELL = /bin/bash

build:
	forge build
	ls -lah out/
t:
	forge test -vvvvv
g:
	ganache --wallet.accounts "${ETH_WALLET_PK},${DEFAULT_BALANCE}" --chain.chainId ${CHAIN_ID}
a:
	anvil --balance ${DEFAULT_BALANCE} --hardfork ${HARDFORK} --ffi -vvv
create:
	forge create --legacy CeramicAnchorServiceV2 --contracts src/CeramicAnchorServiceV2.sol --private-key ${ETH_WALLET_PK} --rpc-url ${ETH_RPC_HOST}:${ETH_RPC_PORT}
invoke:
	cast call ${CONTRACT_ADDRESS} "${FUNC}" --rpc-url ${ETH_RPC_HOST}:${ETH_RPC_PORT}
anchor:
	cast send --private-key ${ETH_WALLET_PK} ${CONTRACT_ADDRESS} "anchorDagCbor(bytes32)" "0x3078300000000000000000000000000000000000000000000000000000000000" --legacy
installDeps:
	forge install foundry-rs/forge-std --no-git
	forge install openzeppelin/openzeppelin-contracts@v4.9.2 --no-git
clean:
	rm -rf cache/ out/ lib/
