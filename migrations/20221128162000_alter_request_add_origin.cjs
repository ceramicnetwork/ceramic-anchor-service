const REQUEST_TABLE_NAME = 'request'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.string('origin', 1024).index()
    table.timestamp('timestamp', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.dropColumns('origin', 'timestamp')
  })
}

module.exports = { up, down }
