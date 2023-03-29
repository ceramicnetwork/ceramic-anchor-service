// RUN VIA npx --loader tsm casv5-demo.ts
import * as providers from '@ethersproject/providers'
import { Interface } from '@ethersproject/abi'
import { create as createMultihash } from 'multiformats/hashes/digest'
import { fromString } from 'uint8arrays'
import { CID } from 'multiformats/cid'
import { create as createIpfsClient } from 'ipfs-http-client'

const ETH_ENDPOINT = 'http://localhost:8545'
const CONTRACT_ADDRESS = '0x663f90c8a3b4da654e2d23b6564426feda684c8f'
const ABI = [
  'function anchorDagCbor(bytes32)',
  'event DidAnchor(address indexed _service, bytes32 _root)',
]

const IPFS_ENDPOINT = 'http://localhost:5001'
const contractInterface = new Interface(ABI)
const provider = new providers.StaticJsonRpcProvider(ETH_ENDPOINT)
const ipfsClient = createIpfsClient({
  url: IPFS_ENDPOINT,
})

async function main() {
  const logs = await provider.getLogs({
    address: CONTRACT_ADDRESS,
    fromBlock: 0,
    toBlock: 10000,
  })

  console.log('-----TRANSACTION LOG----')
  console.log(logs[1], '\n\n')

  const event = contractInterface.parseLog(logs[1])
  console.log('-----EVENT----')
  console.log(event, '\n\n')

  const hexRoot = event.args[1]
  const multihash = createMultihash(0x12, fromString(hexRoot.slice(2), 'base16'))
  const cidRoot = CID.create(1, 0x71, multihash)
  console.log('-----ROOT----')
  console.log(cidRoot, '\n\n')

  const rootData = await ipfsClient.dag.get(cidRoot)
  console.log('-----STORED ROOT DATA----')
  console.log(rootData, '\n\n')

  const rootMetadata = await ipfsClient.dag.get(cidRoot, { path: '2' })
  console.log('-----MERKLE TREE METADATA----')
  console.log(rootMetadata, '\n\n')
}

main()

// curl -X POST "http://127.0.0.1:5001/api/v0/dag/get?arg=<ref>&output-codec=dag-json"
