# Ceramic Anchor Service V2 - Indexable Anchors work
Reference implementation of CIP-110:
https://github.com/ceramicnetwork/CIP/blob/main/CIPs/CIP-110/CIP-110.md

# Contracts
- CeramicAnchorServiceV2.sol
    - Core contract
- CeramicAnchorServiceV2.t.sol
    - test suite for Core

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

### Deploy using forge
```
PRIV_KEY=<PK> make create
```

# Interacting with Contract

Note: ganache doesn't have support

## Basic call
Perform a call on an account without publishing a transaction.
```
make testDeployment
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
