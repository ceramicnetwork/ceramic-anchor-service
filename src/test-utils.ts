import CID from 'cids';
import { CeramicService } from './services/ceramic-service';
import { IpfsService } from './services/ipfs-service';
import { StreamID, CommitID } from '@ceramicnetwork/streamid';

// A set of random valid CIDs to use in tests
// TODO write a random CID generator and use that instead of this list
const RANDOM_CIDS = [
  new CID("bafybeig6xv5nwphfmvcnektpnojts77jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts66jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts55jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts44jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts33jqcuam7bmye2pb54adnrtccjlsu"),
  new CID("bafybeig6xv5nwphfmvcnektpnojts22jqcuam7bmye2pb54adnrtccjlsu"),
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

export class CidGenerator {
  private _cidIndex = 0;

  next(): CID {
    if (this._cidIndex >= RANDOM_CIDS.length) {
      throw new Error("Used too many CIDs!");
    }
    return RANDOM_CIDS[this._cidIndex++]
  }

  reset() {
    this._cidIndex = 0
  }
}

export class MockIpfsService implements IpfsService {
  private _streams: Record<string, any> = {}

  constructor(private _cidGenerator = new CidGenerator()) {}

  async init(): Promise<void> {
    return null;
  }

  async retrieveRecord(cid: CID | string): Promise<any> {
    return this._streams[cid.toString()];
  }

  async storeRecord(record: Record<string, unknown>): Promise<CID> {
    const cid = this._cidGenerator.next();
    this._streams[cid.toString()] = record;
    return cid;
  }

  reset() {
    this._cidGenerator.reset()
    this._streams = {}
  }
}

export class MockCeramicService implements CeramicService {
  constructor(private _streams: Record<string, any> = {}, private _cidIndex = 0) {}

  async loadStream(streamId: StreamID): Promise<any> {
    return this._streams[streamId.toString()]
  }

  // Mock-only method to control what gets returned by loadStream()
  putStream(id: StreamID | CommitID, stream: any) {
    this._streams[id.toString()] = stream
  }

  // Mock-only method to generate a random base StreamID
  generateBaseStreamID(): StreamID {
    if (this._cidIndex >= RANDOM_CIDS.length) {
      throw new Error("Used too many StreamIDs in a test!");
    }
    return new StreamID('tile', RANDOM_CIDS[this._cidIndex++])
  }

  reset() {
    this._cidIndex = 0
    this._streams = {}
  }
}