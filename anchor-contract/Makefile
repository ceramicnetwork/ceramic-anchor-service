RPC = http://127.0.0.1:8545
build:
	forge build
t:
	forge test -vvvvv
g:
	ganache-cli --account "0x2deb08aaf965da17757838c910424c8fe70bb5c7e8fe1171c6b68aebb2cc548b,9000000000000000000000"
a:
	anvil --balance 900000000000000 --hardfork london --ffi -vvv
create:
	#  forge create --legacy CeramicAnchorServiceV2  --contracts src/CeramicAnchorServiceV2.sol --private-key ${PRIV_KEY} --rpc-url http://127.0.0.1:8545
	forge create --legacy CeramicAnchorServiceV2  --contracts src/CeramicAnchorServiceV2.sol --private-key ${PRIV_KEY} --rpc-url ${RPC}
checkOwner:
	cast call ${ADDRESS} "owner()" --rpc-url ${RPC}
