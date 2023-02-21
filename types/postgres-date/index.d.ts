declare module 'postgres-date' {
  function parseDate(input: string): Date
  export = parseDate
}
