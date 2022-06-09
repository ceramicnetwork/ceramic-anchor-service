# Ceramic Anchor Service V2 - Indexable Anchors work
Reference implementation of CIP-110:
https://github.com/ceramicnetwork/CIP/blob/main/CIPs/CIP-110/CIP-110.md

# Contracts
- CeramicAnchorServiceV2.sol
    - Core contract
- CeramicAnchorServiceV2.t.sol
    - test suite for Core

## 
```
make build
```

##  Run Tests
```
make t
```

## Deploy to network
```
make create
```

## Basic call
Perform a call on an account without publishing a transaction.
```
make testDeployment
```