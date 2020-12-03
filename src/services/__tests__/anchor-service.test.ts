import 'reflect-metadata';

process.env.NODE_ENV = 'test';

import CID from 'cids';

import { container } from "tsyringe";

import { Request } from "../../models/request";
import { RequestStatus } from "../../models/request-status";
import AnchorService from "../anchor-service";

// A set of random valid CIDs to use in tests
// TODO write a random CID generator and use that instead of this list
const randomCIDs = [
  new CID("bafybeig6xv5nwphfmvcnektpnojts22jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts33jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts44jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts55jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts66jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts77jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bagcqcera6jlmswuihr6fx6e5dmpkxsuh25acrgt4zg4xnajohfqhneawyvqa"),
  new CID("bagcqceraetdzvhnw2jdjvoxbwufxwbw55n5xafd6z3o2emph3647uzdqaaia"),
  new CID("bagcqceraxfvyjsaaepdgghfnbmow7hpylcs3azvjrmczcuaxxraow355ucba"),
  new CID("bagcqcerak3cgizcpx6d6lzk6mduhbjnmuqaqoxlmscquqpy6hw72ocna54da"),
  new CID("bagcqceracggxyb4tfbbzcmqtmvnosq355yiirvnexpj6uzv772dem3hgf7ca"),
  new CID("bagcqceraxgc33kqes6d34cnkjcapy6jjo7yjzszvkwyclsdhey2ij3fxqjva"),
  new CID("bagcqcera4gpni4oqh3q4npyxqpmvp7abo3uo6jdot4m2c3rsn7gdhrxks4wa"),
  new CID("bagcqcera7h3h6frsr5mdb37zeozowti7do4tipmrof7f77su4vplyskz647q"),
  new CID("bagcqcera7riqdpj7nlqoqzomkpvl77wkkti47esi53pih5mq6s3lvphngr6a"),
  new CID("bagcqcera2obsxj7olbjjjcsgae6yfd2i66k6ws25zrfgan4qnqchzfglbylq"),
  new CID("bagcqceraxn27zerw7wpps2uonf6x2fkldfhhnwaulgspu65dbr3j5cltjw7q"),
  new CID("bagcqcera6roxwdpjdocfv6lchvog4uo7algdbrh2tedp64u2o3dmrij4e64a"),
  new CID("bagcqceraxj62ebctzvszj4smdeyrd2uukxrs3wmc4pdznimkrpx6l4bo4bjq"),
  new CID("bagcqceragv2qvqka7k3od4wdqlamz6lej3i63fbkssxkovqbmvrqnmrwzwhq"),
  new CID("bagcqcerab3b2hyts6caulbcgpal3cxtgsnkeuposp3wqr55zy5ih5bw65qka"),
  new CID("bagcqcera7ridgjuj5yxu427jbv3yixmavl2mnwyta25xciqaeljpcgpbyq2a"),
  new CID("bagcqceragvpqmxwopagdjy67xbcidn7uks467y7sdkenbfovszaz25tirycq"),
  new CID("bagcqceraej5ixcmax6lv5f5zjol733hsaz3s6lb24qmokg5fb7j72dmghtja"),
  new CID("bagcqcerankz427e6c4jvszhiaew6b26mwkuhx6nvdod6g36xohmsujxbvjma"),
  new CID("bagcqceraj2psqqlu62bebwt5dnw3zswkyyquphv5zftz3bfn373xq7t53n3a"),
  new CID("bagcqcerah4jjbqc5abgr5mlqbf6wm6juvmu6loqhegdyq6fxqn73dsxvse6a"),
];

class MockIpfsService implements IpfsService {

  constructor(private _docs: Record<string, any> = {}, private _cidIndex = 0) {}

  async init(): Promise<void> {
    return null;
  }

  async retrieveRecord(cid: CID | string): Promise<any> {
    return this._docs[cid.toString()];
  }

  async storeRecord(record: Record<string, unknown>): Promise<CID> {
    if (this._cidIndex >= randomCIDs.length) {
      throw new Error("Used too many CIDs in a test!");
    }
    const cid = randomCIDs[this._cidIndex++];
    this._docs[cid.toString()] = record;
    return cid;
  }

  async reset(): Promise<void> {
    this._cidIndex = 0
    this._docs = {}
  }
}

import DBConnection from './db-connection';

import EthereumBlockchainService from "../blockchain/ethereum/ethereum-blockchain-service";
jest.mock("../blockchain/ethereum/ethereum-blockchain-service");

import { initializeTransactionalContext } from 'typeorm-transactional-cls-hooked';
import RequestRepository from "../../repositories/request-repository";
import CeramicService from "../ceramic-service";
import { IpfsService } from "../ipfs-service";
import AnchorRepository from "../../repositories/anchor-repository";
import { config } from 'node-config-ts';

initializeTransactionalContext();

async function createRequest(docId: string, ipfsService: IpfsService): Promise<Request> {
  const cid = await ipfsService.storeRecord({})
  const request = new Request();
  request.cid = cid.toString();
  request.docId = docId;
  request.status = RequestStatus.PENDING;
  request.message = 'Request is pending.';
  return request
}

describe('ETH service',  () => {
  jest.setTimeout(10000);
  let ipfsService

  beforeAll(async () => {
    await DBConnection.create();
    ipfsService = new MockIpfsService()

    container.registerSingleton("anchorRepository", AnchorRepository);
    container.registerSingleton("requestRepository", RequestRepository);
    container.registerSingleton("blockchainService", EthereumBlockchainService);
    container.register("ipfsService", {
      useValue: ipfsService
    });
    container.registerSingleton("ceramicService", CeramicService);
    container.registerSingleton("anchorService", AnchorService);
  });

  beforeEach(async () => {
    await DBConnection.clear();
    await ipfsService.reset()
  });

  afterAll(async () => {
    await DBConnection.close();
  });

  test('check state on tx fail', async () => {
    const sendTransaction = jest.fn();
    EthereumBlockchainService.prototype.sendTransaction = sendTransaction;
    sendTransaction.mockImplementation(() => {
      throw new Error('Failed to send transaction!');
    });

    const docId = '/ceramic/bagjqcgzaday6dzalvmy5ady2m5a5legq5zrbsnlxfc2bfxej532ds7htpova';
    const cid = await ipfsService.storeRecord({})

    let request = new Request();
    request.cid = cid.toString();
    request.docId = docId;
    request.status = RequestStatus.PENDING;
    request.message = 'Request is pending.';

    const requestRepository = container.resolve<RequestRepository>('requestRepository');
    await requestRepository.createOrUpdate(request);

    const anchorService = container.resolve<AnchorService>('anchorService');
    await expect(anchorService.anchorRequests()).rejects.toEqual(new Error('Failed to send transaction!'))

    request = await requestRepository.findByCid(cid);
    expect(request).toHaveProperty('status', RequestStatus.PROCESSING);

    const requests = await requestRepository.findNextToProcess();
    expect(requests).toBeDefined();
    expect(requests).toBeInstanceOf(Array);
    expect(requests).toHaveLength(1);
  });

  test('create anchor records', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository');
    const anchorService = container.resolve<AnchorService>('anchorService');

    // Create pending requests
    const requests = []
    const numRequests = 4
    for (let i = 0; i < numRequests; i++) {
      const request = await createRequest("docid" + i, ipfsService)
      await requestRepository.createOrUpdate(request);
      requests.push(request)
    }

    const candidates = await anchorService._findCandidates(requests)
    const merkleTree = await anchorService._buildMerkleTree(candidates)
    const ipfsProofCid = await ipfsService.storeRecord({})

    const anchors = await anchorService._createAnchorRecords(ipfsProofCid, merkleTree, requests)

    expect(candidates.length).toEqual(requests.length)
    expect(anchors.length).toEqual(candidates.length)

    for (const i in anchors) {
      const anchor = anchors[i]
      expect(anchor.proofCid).toEqual(ipfsProofCid.toString())
      expect(anchor.request).toEqual(requests[i])

      const anchorRecord = await ipfsService.retrieveRecord(anchor.cid)
      expect(anchorRecord.prev.toString()).toEqual(requests[i].cid)
      expect(anchorRecord.proof).toEqual(ipfsProofCid)
      expect(anchorRecord.path).toEqual(anchor.path)
    }

    expect(anchors[0].path).toEqual("0/0")
    expect(anchors[1].path).toEqual("0/1")
    expect(anchors[2].path).toEqual("1/0")
    expect(anchors[3].path).toEqual("1/1")
  });

  test('Too many anchor requests', async () => {
    const requestRepository = container.resolve<RequestRepository>('requestRepository');
    const anchorService = container.resolve<AnchorService>('anchorService');

    const depthLimit = 2
    config.merkleDepthLimit = depthLimit
    const nodeLimit = Math.pow(2, depthLimit)
    const numRequests = nodeLimit * 2 // twice as many requests as can fit

    // Create pending requests
    for (let i = 0; i < numRequests; i++) {
      const request = await createRequest("docid" + i, ipfsService)
      await requestRepository.createOrUpdate(request);
    }

    // First pass anchors half the pending requests
    let requests = await requestRepository.findNextToProcess()
    expect(requests.length).toEqual(numRequests)
    const anchorPendingRequests = async function(requests: Request[]): Promise<void> {
      const candidates = await anchorService._findCandidates(requests)

      const merkleTree = await anchorService._buildMerkleTree(candidates)
      const ipfsProofCid = await ipfsService.storeRecord({})
      const anchors = await anchorService._createAnchorRecords(ipfsProofCid, merkleTree, requests)

      await anchorService._persistAnchorResult(anchors)
    }
    await anchorPendingRequests(requests)

    requests = await requestRepository.findNextToProcess()
    expect(requests.length).toEqual(numRequests / 2)

    // // Second pass anchors the remaining half of the original requests
    await anchorPendingRequests(requests)

    // All requests should have been processed
    requests = await requestRepository.findNextToProcess()
    expect(requests.length).toEqual(0)
  });

});
