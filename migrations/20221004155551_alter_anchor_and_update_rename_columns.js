const REQUEST_TABLE_NAME = 'request'
const ANCHOR_TABLE_NAME = 'anchor'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  // Misnamed when the tables were created with typeORM (there is a space at the end of the column name)
  await knex.raw(`alter table "${ANCHOR_TABLE_NAME}" RENAME COLUMN "request_id " TO "request_id"`)
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.renameColumn('doc_id', 'stream_id')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.raw(`alter table "${ANCHOR_TABLE_NAME}" RENAME COLUMN "request_id" TO "request_id "`)
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.renameColumn('stream_id', 'doc_id')
  })
}
