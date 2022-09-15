// import type { EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm'
// import TypeORM from 'typeorm'
// const { EventSubscriber } = TypeORM
// import { Request } from '../models/request.js'
// import { logEvent } from '../logger/index.js'

// // TODO STEPH: REPLACE
// @EventSubscriber()
// export class RequestSubscriber implements EntitySubscriberInterface<Request> {
//   listenTo(): typeof Request {
//     return Request
//   }

//   afterInsert(event: InsertEvent<Request>): void {
//     logEvent.db({
//       type: 'request',
//       ...event.entity,
//       createdAt: event.entity.createdAt.getTime(),
//       updatedAt: event.entity.updatedAt.getTime(),
//     })
//   }

//   // Entity is only populated if save is called
//   afterUpdate(event: UpdateEvent<Request>): void {
//     if (event.entity) {
//       logEvent.db({
//         type: 'request',
//         ...event.entity,
//         createdAt: event.entity.createdAt.getTime(),
//         updatedAt: event.entity.updatedAt.getTime(),
//       })
//     }
//   }
// }
