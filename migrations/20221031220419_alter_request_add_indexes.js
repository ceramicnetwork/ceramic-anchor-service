const REQUEST_TABLE_NAME = 'request'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.index(['stream_id'])
    table.index(['status'])
    table.index(['created_at'])
    table.index(['updated_at'])
    table.index(['status', 'created_at'])
    table.index(['status', 'updated_at'])
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.dropIndex(['stream_id'])
    table.dropIndex(['status'])
    table.dropIndex(['created_at'])
    table.dropIndex(['updated_at'])
    table.dropIndex(['status', 'created_at'])
    table.dropIndex(['status', 'updated_at'])
  })
}
