import { RequestStatus } from './request-status';
import {
  Entity,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  UpdateEvent,
  Unique
} from 'typeorm';
import { logEvent } from '../logger';
import { setColumnsToUpdate, setUpdatedColumns } from './model-helpers';

@Entity()
@Unique(['cid'])
export class Request {
  @PrimaryGeneratedColumn('uuid')
  id: number;

  @Column({ nullable: false })
  status: RequestStatus;

  @Column({ nullable: false })
  cid: string;

  @Column({ nullable: false, name: 'doc_id' })
  docId: string;

  @Column({ nullable: true })
  message: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@EventSubscriber()
export class RequestSubscriber implements EntitySubscriberInterface<Request> {
  protected prevColumnsToUpdate: object
  protected currUpdatedColumns: object
  
  listenTo() {
    return Request;
  }

  afterInsert(event: InsertEvent<Request>) {
    logEvent.db({
      type: 'request',
      ...event.entity
    })
  }

  beforeUpdate(event: UpdateEvent<Request>): Promise<any> | void {
    setColumnsToUpdate(event, this.prevColumnsToUpdate)
  }

  afterUpdate(event: UpdateEvent<Request>) {
    setUpdatedColumns(event, this.currUpdatedColumns)

    if ('status' in this.currUpdatedColumns) {
      logEvent.db({
        type: 'request',
        status: this.currUpdatedColumns
      });
    }
  }

}

/**
 * Request update  fields
 */
export interface RequestUpdateFields {
  message: string;
  status: RequestStatus;
}
