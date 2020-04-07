import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';

import { Request } from './request';

@Entity()
export class Anchor {
  @PrimaryGeneratedColumn('uuid')
  id: number;

  @OneToOne((type) => Request)
  @JoinColumn({ name: 'request_id ' })
  request: Request;

  @Column({ nullable: false })
  path: string;

  @Column({ nullable: false })
  proof: string;

  @Column({ nullable: false })
  chain: number;

  @Column({ nullable: false, name: 'block_number' })
  blockNumber: number;

  @Column({ nullable: false, name: 'block_timestamp' })
  blockTimestamp: number;

  @Column({ nullable: false, name: 'tx_hash' })
  txHash: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
