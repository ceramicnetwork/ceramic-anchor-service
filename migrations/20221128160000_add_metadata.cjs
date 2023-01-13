// This migration creates metadata table.

const TABLE_NAME = 'metadata'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.string('stream_id', 1024).notNullable().unique().primary().index()
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
    table.timestamp('used_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
    table.jsonb('metadata').notNullable()
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  await knex.schema.dropTable(TABLE_NAME)
}

module.exports = { up, down }
