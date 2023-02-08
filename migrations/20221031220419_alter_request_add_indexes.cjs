const REQUEST_TABLE_NAME = 'request'
const ANCHOR_TABLE_NAME = 'anchor'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.index(['stream_id'])
    table.index(['created_at'])
    table.index(['updated_at'])
    table.index(['status', 'created_at'])
    table.index(['status', 'updated_at'])
  })

  await knex.schema.alterTable(ANCHOR_TABLE_NAME, (table) => {
    table.index(['cid'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.dropIndex(['stream_id'])
    table.dropIndex(['created_at'])
    table.dropIndex(['updated_at'])
    table.dropIndex(['status', 'created_at'])
    table.dropIndex(['status', 'updated_at'])
  })

  await knex.schema.alterTable(ANCHOR_TABLE_NAME, (table) => {
    table.dropIndex(['cid'])
  })
}

module.exports = { up, down }
