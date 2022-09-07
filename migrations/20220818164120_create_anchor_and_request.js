const REQUEST_TABLE_NAME = 'request'
const TEMP_TABLE_NAME = 'temp'
const ANCHOR_TABLE_NAME = 'anchor'

const sortByStringKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))

const checkObjEquality = (expected, received) =>
  JSON.stringify(sortByStringKeys(expected)) === JSON.stringify(sortByStringKeys(received))

const verifyTableStructure = async (knex, tableWithValidStructure, tableToCheck) => {
  const [expectedStructure, existingStructure] = await Promise.all([
    knex(tableWithValidStructure).columnInfo(),
    knex(tableToCheck).columnInfo(),
  ])
  const structuresAreEqual = checkObjEquality(expectedStructure, existingStructure)
  if (!structuresAreEqual) {
    throw Error(`Existing ${tableToCheck} table does not have the expected structure`)
  }
}

const createRequestTable = async (knex, tableName) => {
  await knex.schema.createTable(tableName, (table) => {
    table.uuid('id').notNullable().unique().primary().defaultTo(knex.raw('uuid_generate_v4()'))
    table.integer('status').notNullable()
    table.boolean('pinned').notNullable().defaultTo(false)
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
  })

  // knex defaults to varchar(255).
  // This is not best practise as noted here: https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_varchar.28n.29_by_default
  // knex has an open PR to fix this but as a workaround we use raw queries
  await knex.schema
    .raw(`alter table "${tableName}" add column "cid" varchar NOT NULL UNIQUE`)
    .raw(`alter table "${tableName}" add column "doc_id" varchar NOT NULL`)
    .raw(`alter table "${tableName}" add column "message" varchar`)
}

const createRequestTableIfNotExists = async (knex) => {
  const tableExists = await knex.schema.hasTable(REQUEST_TABLE_NAME)

  if (!tableExists) {
    await createRequestTable(knex, REQUEST_TABLE_NAME)
  } else {
    await createRequestTable(knex, TEMP_TABLE_NAME)
    await verifyTableStructure(knex, TEMP_TABLE_NAME, REQUEST_TABLE_NAME)
    await knex.schema.dropTable(TEMP_TABLE_NAME)
  }

  // explicitly rename the doc_id column to stream_id
  await knex.schema.alterTable(REQUEST_TABLE_NAME, (table) => {
    table.renameColumn('doc_id', 'stream_id')
  })
}

const createAnchorTable = async (knex, tableName) => {
  await knex.schema.createTable(tableName, (table) => {
    table.uuid('id').notNullable().unique().primary().defaultTo(knex.raw('uuid_generate_v4()'))
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
  })

  await knex.schema
    // we create this column manually because it was misnamed when we originally used typeorm
    .raw(`alter table "${tableName}" add column "request_id " UUID UNIQUE REFERENCES request (id)`)
    .raw(`alter table "${tableName}" add column "path" varchar NOT NULL`)
    .raw(`alter table "${tableName}" add column "cid" varchar NOT NULL`)
    .raw(`alter table "${tableName}" add column "proof_cid" varchar NOT NULL`)
}

const createAnchorTableIfNotExists = async (knex) => {
  const tableExists = await knex.schema.hasTable(ANCHOR_TABLE_NAME)

  if (!tableExists) {
    await createAnchorTable(knex, ANCHOR_TABLE_NAME)
  } else {
    await createAnchorTable(knex, TEMP_TABLE_NAME)
    await verifyTableStructure(knex, TEMP_TABLE_NAME, ANCHOR_TABLE_NAME)
    await knex.schema.dropTable(TEMP_TABLE_NAME)
  }
  // when we originally used typeorm, an extra space was added to the column name in error. I correct this here.
  await knex.raw(`alter table "${ANCHOR_TABLE_NAME}" RENAME COLUMN "request_id " TO "request_id"`)
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
  await createRequestTableIfNotExists(knex)
  await createAnchorTableIfNotExists(knex)
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down() {
  throw Error('Cannot rollback as request and anchor tables may have existed prior to migration')
}
