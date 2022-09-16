import type { Knex } from 'knex'

/**
 * Options for repository functions
 */

export interface Options {
  connection?: Knex // connection to use in query (allows for transactions)
}

export interface LimitOptions extends Options {
  limit?: number // max number of rows to return
}
