import TypeORM from 'typeorm'
const {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} = TypeORM

import { Request } from './request.js'

@Entity()
export class Anchor {
  @PrimaryGeneratedColumn('uuid')
  id: number

  @OneToOne(() => Request)
  @JoinColumn({ name: 'request_id ' })
  request: Request

  @Column({ nullable: false })
  path: string

  @Column({ nullable: false })
  cid: string

  @Column({ nullable: false, name: 'proof_cid' })
  proofCid: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
