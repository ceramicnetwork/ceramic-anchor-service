# Ceramic Anchor Service V2 - Indexable Anchors work
Reference implementation of CIP-110:
https://github.com/ceramicnetwork/CIP/blob/main/CIPs/CIP-110/CIP-110.md

## References
- https://github.com/foundry-rs/foundry

# Contracts
- CeramicAnchorServiceV2.sol
    - Core contract
- CeramicAnchorServiceV2.t.sol
    - test suite for Core

# Makefile Variables
Vriables in Makefile
- ```RPC```
    - RPC Endpoint
- ```HARDFORK```
    - chosen hardfork
- ```FUNC```
    - function to invoke
- ```PRIV_KEY```
    - private key for deployer
- ```CONTRACT_ADDRESS```
    - CeramicAnchorServiceV2 contract address
- ```DEPLOYER_ADDRESS```
    - address of deployer
- ```DEFAULT_BALANCE```
    -balance for each local node account
- ```DEFAULT_ACCOUNT```
    - default account for local node


## Build
```
make build
```

##  Run Tests
```
make t
```

## Deploy to local ganache

### Run Ganache
```
make g
```

### Run Anvil (Alternative to Ganache)
```
make g
```

### Deploy to local node, or testnet
```
make create
```

# Interacting with Contract

Note: ganache doesn't have support for EIP-1559 yet:
https://github.com/trufflesuite/ganache/issues/939

### Invoke arbitrary function
Use this to invoke an arbitrary function from the contract
```
make invoke
```

# Gas Differences between struct and bool
- Struct
```
[PASS] testAddCas() (gas: 31049)
[PASS] testAddCasFuzz(address) (runs: 256, μ: 31185, ~: 31185)
[PASS] testAnchor() (gas: 34307)
[PASS] testAnchorFuzz(bytes) (runs: 256, μ: 34754, ~: 34594)
[PASS] testFailOwnershipChangeToZeroAddress() (gas: 11309)
[PASS] testIfAllowedServiceIsAllowed() (gas: 32201)
[PASS] testIfDisallowedServiceIsAllowed() (gas: 7864)
[PASS] testOwner() (gas: 7642)
[PASS] testOwnershipChange() (gas: 12411)
[PASS] testOwnershipChangeFuzz(address) (runs: 256, μ: 15354, ~: 15464)
Test result: ok. 10 passed; 0 failed; finished in 86.43ms
```
- Bool
```
[PASS] testAddCas() (gas: 31049)
[PASS] testAddCasFuzz(address) (runs: 256, μ: 31185, ~: 31185)
[PASS] testAnchor() (gas: 34307)
[PASS] testAnchorFuzz(bytes) (runs: 256, μ: 34767, ~: 34594)
[PASS] testFailOwnershipChangeToZeroAddress() (gas: 11309)
[PASS] testIfAllowedServiceIsAllowed() (gas: 32201)
[PASS] testIfDisallowedServiceIsAllowed() (gas: 7864)
[PASS] testOwner() (gas: 7642)
[PASS] testOwnershipChange() (gas: 12411)
[PASS] testOwnershipChangeFuzz(address) (runs: 256, μ: 15464, ~: 15464)
Test result: ok. 10 passed; 0 failed; finished in 92.16ms
```
