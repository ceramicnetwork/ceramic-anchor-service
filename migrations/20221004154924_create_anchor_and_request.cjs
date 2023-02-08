// This migration is creating an anchor and request table if they do not exist.
// If they do exist we are verifying their structure

// Notes:
//
// We do not use table.varchar to create varchar columns because knex defaults to varchar(255)
// This is not best practise: https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_varchar.28n.29_by_default
// knex has an open PR to fix this but as a workaround we use raw queries
//
// We also create the anchor table's request_id column manually because it was originally
// misnamed when the tables were created with typeORM (there is a trailing space)

const ANCHOR_TABLE_NAME = 'anchor'
const ANCHOR_TABLE_COLUMN_INFO = {
  id: {
    type: 'uuid',
    maxLength: null,
    nullable: false,
    defaultValue: 'uuid_generate_v4()',
  },
  created_at: {
    type: 'timestamp without time zone',
    maxLength: null,
    nullable: false,
    defaultValue: 'now()',
  },
  updated_at: {
    type: 'timestamp without time zone',
    maxLength: null,
    nullable: false,
    defaultValue: 'now()',
  },
  'request_id ': { type: 'uuid', maxLength: null, nullable: true, defaultValue: null },
  path: {
    type: 'character varying',
    maxLength: null,
    nullable: false,
    defaultValue: null,
  },
  cid: {
    type: 'character varying',
    maxLength: null,
    nullable: false,
    defaultValue: null,
  },
  proof_cid: {
    type: 'character varying',
    maxLength: null,
    nullable: false,
    defaultValue: null,
  },
}

const REQUEST_TABLE_NAME = 'request'
const REQUEST_TABLE_COLUMN_INFO = {
  id: {
    type: 'uuid',
    maxLength: null,
    nullable: false,
    defaultValue: 'uuid_generate_v4()',
  },
  status: {
    type: 'integer',
    maxLength: null,
    nullable: false,
    defaultValue: null,
  },
  pinned: {
    type: 'boolean',
    maxLength: null,
    nullable: false,
    defaultValue: 'false',
  },
  created_at: {
    type: 'timestamp without time zone',
    maxLength: null,
    nullable: false,
    defaultValue: 'now()',
  },
  updated_at: {
    type: 'timestamp without time zone',
    maxLength: null,
    nullable: false,
    defaultValue: 'now()',
  },
  cid: {
    type: 'character varying',
    maxLength: null,
    nullable: false,
    defaultValue: null,
  },
  doc_id: {
    type: 'character varying',
    maxLength: null,
    nullable: false,
    defaultValue: null,
  },
  message: {
    type: 'character varying',
    maxLength: null,
    nullable: true,
    defaultValue: null,
  },
}
const verifyTableStructure = async (validColumnInfo, columnInfoToVerify) =>
  Object.entries(validColumnInfo).every(
    ([key, value]) => JSON.stringify(columnInfoToVerify[key]) === JSON.stringify(value)
  )

const createRequestTable = async (knex, tableName) => {
  await knex.schema.createTable(tableName, (table) => {
    table.uuid('id').notNullable().unique().primary().defaultTo(knex.raw('uuid_generate_v4()'))
    table.integer('status').notNullable()
    table.boolean('pinned').notNullable().defaultTo(false)
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
  })

  await knex.schema
    .raw(`alter table "${tableName}" add column "cid" varchar NOT NULL UNIQUE`)
    .raw(`alter table "${tableName}" add column "doc_id" varchar NOT NULL`)
    .raw(`alter table "${tableName}" add column "message" varchar`)
}

const createAnchorTable = async (knex, tableName) => {
  await knex.schema.createTable(tableName, (table) => {
    table.uuid('id').notNullable().unique().primary().defaultTo(knex.raw('uuid_generate_v4()'))
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.raw('now()'))
  })

  await knex.schema
    .raw(`alter table "${tableName}" add column "request_id " UUID UNIQUE REFERENCES request (id)`)
    .raw(`alter table "${tableName}" add column "path" varchar NOT NULL`)
    .raw(`alter table "${tableName}" add column "cid" varchar NOT NULL`)
    .raw(`alter table "${tableName}" add column "proof_cid" varchar NOT NULL`)
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

  const requestTableExists = await knex.schema.hasTable(REQUEST_TABLE_NAME)
  if (!requestTableExists) {
    await createRequestTable(knex, REQUEST_TABLE_NAME)
  } else {
    const columnInfo = await knex(REQUEST_TABLE_NAME).columnInfo()
    const requestTableIsValid = verifyTableStructure(REQUEST_TABLE_COLUMN_INFO, columnInfo)
    if (!requestTableIsValid) {
      throw new Error(`Existing ${REQUEST_TABLE_NAME} table does not have the expected structure`)
    }
  }

  const anchorTableExists = await knex.schema.hasTable(ANCHOR_TABLE_NAME)
  if (!anchorTableExists) {
    await createAnchorTable(knex, ANCHOR_TABLE_NAME)
  } else {
    const columnInfo = await knex(ANCHOR_TABLE_NAME).columnInfo()
    const requestTableIsValid = verifyTableStructure(ANCHOR_TABLE_COLUMN_INFO, columnInfo)
    if (!requestTableIsValid) {
      throw new Error(`Existing ${ANCHOR_TABLE_NAME} table does not have the expected structure`)
    }
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down() {
  throw new Error(
    'Cannot rollback as request and anchor tables may have existed prior to migration'
  )
}

module.exports = { up, down }
