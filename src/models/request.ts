import { RequestStatus } from './request-status.js'
import TypeORM from 'typeorm'
const { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } =
  TypeORM

@Entity()
@Unique(['cid'])
export class Request {
  @PrimaryGeneratedColumn('uuid')
  id: number

  @Column({ nullable: false })
  status: RequestStatus

  @Column({ nullable: false })
  cid: string

  @Column({ nullable: false, name: 'doc_id' })
  streamId: string

  @Column({ nullable: true })
  message: string

  @Column({ nullable: false, default: false })
  pinned: boolean

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}

/**
 * Request update  fields
 */
export interface RequestUpdateFields {
  message?: string
  status?: RequestStatus
  pinned?: boolean
}
