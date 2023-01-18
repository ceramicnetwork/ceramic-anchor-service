import { DateTime } from 'luxon'

/**
 * Current timestamp as a UNIX integer
 * @returns Integer
 */
export const now = (): number => { return DateTime.now().toUnixInteger() }
