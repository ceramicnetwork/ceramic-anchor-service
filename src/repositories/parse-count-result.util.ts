/**
 * Parse result of Knex `count` query.
 */
export function parseCountResult(count: string | number): number {
  return parseInt(String(count), 10) // `count` could be string or number, let's be pessimistic
}
