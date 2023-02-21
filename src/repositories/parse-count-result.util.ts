/**
 * Parse result of Knex `count` query.
 */
export function parseCountResult(count: string | number | undefined): number {
  if (!count) return 0
  return parseInt(String(count), 10) // `count` could be string or number, let's be pessimistic
}
