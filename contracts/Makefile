RPC = http://127.0.0.1:8545
HARDFORK = london
FUNC = owner()
PRIV_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
CONTRACT_ADDRESS = 0x5fbdb2315678afecb367f032d93f642f64180aa3
DEPLOYER_ADDRESS = 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
DEFAULT_BALANCE = 900000000000000000
DEFAULT_ACCOUNT = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
GAS_LIMIT = 90000000000000000
SHELL = /bin/bash
build:
	forge build
t:
	forge test -vvvvv
g:
	ganache-cli --account "${DEFAULT_ACCOUNT},${DEFAULT_BALANCE}" --chainId 3
a:
	# anvil --balance ${DEFAULT_BALANCE} --hardfork ${HARDFORK} --ffi -vvv --block-gas-limit ${GAS_LIMIT} --gas-limit ${GAS_LIMIT}
	anvil --balance ${DEFAULT_BALANCE} --hardfork ${HARDFORK} --ffi -vvv
create:
	forge create --legacy CeramicAnchorServiceV2 --contracts src/CeramicAnchorServiceV2.sol --private-key ${PRIV_KEY} --rpc-url ${RPC}
invoke:
	cast call ${CONTRACT_ADDRESS} "${FUNC}" --rpc-url ${RPC}
anchor:
	cast send --private-key 419366905399a4118c5eb6639f847e247c94dad427efb91ee98882f4b1c2a39a 0x48DCAdC95576ecC7472B3F76153Fb411E84a49CF "anchor(bytes32)" "0x3078300000000000000000000000000000000000000000000000000000000000" --legacy
installDeps:
	forge install foundry-rs/forge-std --no-git
	forge install openzeppelin/openzeppelin-contracts --no-git
clean:
	rm -rf cache/ out/ lib/
