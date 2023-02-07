import type { Knex } from 'knex'

/**
 * Options for repository functions
 */

export interface Options {
  connection?: Knex // connection to use in query (allows for transactions)
}
