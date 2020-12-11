import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { Request } from '../models/request';
import { logEvent } from '../logger';

@EventSubscriber()
export class RequestSubscriber implements EntitySubscriberInterface<Request> {

  listenTo(): typeof Request {
    return Request;
  }

  afterInsert(event: InsertEvent<Request>): void {
    logEvent.db({
      type: 'request',
      ...event.entity,
      createdAt: event.entity.createdAt.getTime(),
      updatedAt: event.entity.updatedAt.getTime()
    });
  }

  // Entity is only populated if save is called
  afterUpdate(event: UpdateEvent<Request>): void {
    if (event.entity) {
      logEvent.db({
        type: 'request',
        ...event.entity,
        createdAt: event.entity.createdAt.getTime(),
        updatedAt: event.entity.updatedAt.getTime()
      });
    }
  }
}
