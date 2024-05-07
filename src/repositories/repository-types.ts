import type { Knex } from 'knex'

// application is recommended to automatically retry when seeing this error
export const REPEATED_READ_SERIALIZATION_ERROR = '40001'

/**
 * Options for repository functions
 */
export interface Options {
  connection?: Knex // connection to use in query (allows for transactions)
}
