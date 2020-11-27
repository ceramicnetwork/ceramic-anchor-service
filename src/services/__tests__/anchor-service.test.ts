import 'reflect-metadata';

process.env.NODE_ENV = 'test';

import CID from 'cids';

import Context from "../../context";
import { Request } from "../../models/request";
import { RequestStatus } from "../../models/request-status";
import RequestService from "../request-service";
import AnchorService from "../anchor-service";

class IpfsService implements Contextual {
  public ipfs: any;

  setContext(): void {
    this.ipfs = createIPFS();
  }

  async tryToFetchByCIDs(requests: Array<Request>): Promise<Array<number>> {
    return []
  }

  async retrieveRecord(cid: CID | string): Promise<any> {
    const record = await this.ipfs.dag.get(cid);
    return record.value;
  }

  async storeRecord(record: Record<string, unknown>): Promise<CID> {
    return this.ipfs.dag.put(record);
  }
}

import DBConnection from './db-connection';

import EthereumBlockchainService from "../blockchain/ethereum/ethereum-blockchain-service";
jest.mock("../blockchain/ethereum/ethereum-blockchain-service");

import { initializeTransactionalContext } from 'typeorm-transactional-cls-hooked';
initializeTransactionalContext();

import Contextual from "../../contextual";
import { Logger as logger } from "@overnightjs/logger/lib/Logger";

const createIPFS = () => {
  return {
    dag: {
      get(): any {
        return {
          value: {
            header: {
              nonce: 1
            }
          }
        };
      }
    }
  };
};

describe('ETH service',  () => {
  jest.setTimeout(10000);

  beforeAll(async () => {
    await DBConnection.create();
  });

  beforeEach(async () => {
    await DBConnection.clear();
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

    const ctx = new Context();
    await ctx.build('services', 'repositories', new IpfsService());

    const docId = '/ceramic/bagjqcgzaday6dzalvmy5ady2m5a5legq5zrbsnlxfc2bfxej532ds7htpova';
    const cid = new CID('bafybeig6xv5nwphfmvcnektpnojts33jqcuam7bmye2pb54adnrtccjlsu');

    let request = new Request();
    request.cid = cid.toString();
    request.docId = docId;
    request.status = RequestStatus.PENDING;
    request.message = 'Request is pending.';

    const requestService: RequestService = ctx.lookup('RequestService');
    await requestService.createOrUpdate(request);

    const ceramicService: IpfsService = ctx.lookup('IpfsService');
    ceramicService.ipfs = createIPFS();

    const anchorService: AnchorService = ctx.lookup('AnchorService');
    await expect(anchorService.anchorRequests()).rejects.toEqual(new Error('Failed to send transaction!'))

    request = await requestService.findByCid(cid);
    expect(request).toHaveProperty('status', RequestStatus.PROCESSING);

    const requests = await requestService.findNextToProcess();
    expect(requests).toBeDefined();
    expect(requests).toBeInstanceOf(Array);
    expect(requests).toHaveLength(1);
  });

});
