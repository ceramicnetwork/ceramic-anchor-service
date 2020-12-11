import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { setColumnsToUpdate, setUpdatedColumns } from '../model-helpers';
import { Request } from '../models/request';
import { logEvent } from '../logger';

@EventSubscriber()
export class RequestSubscriber implements EntitySubscriberInterface<Request> {
  protected prevColumnsToUpdate: object;
  protected currUpdatedColumns: object;
  
  listenTo(): typeof Request {
    return Request;
  }

  afterInsert(event: InsertEvent<Request>): void {
    logEvent.db({
      type: 'request',
      ...event.entity
    });
  }

  beforeUpdate(event: UpdateEvent<Request>): Promise<any> | void {
    setColumnsToUpdate(event, this.prevColumnsToUpdate);
  }

  afterUpdate(event: UpdateEvent<Request>): void {
    setUpdatedColumns(event, this.currUpdatedColumns);

    if ('status' in this.currUpdatedColumns) {
      logEvent.db({
        type: 'request',
        status: this.currUpdatedColumns
      });
    }
  }
}
