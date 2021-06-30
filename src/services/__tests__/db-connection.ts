import { Connection, ConnectionOptions, createConnection, getConnection } from 'typeorm';
import { Anchor } from "../../models/anchor";
import { Request } from "../../models/request";

function getSqliteConfig(name: string): ConnectionOptions {
  return {
    name,
    type: "sqlite",
    database: ":memory:",
    entities: [Request, Anchor],
    synchronize: true,
    logging: false,
    dropSchema: true,
  }
}

const DBConnection = {
  numConnections: 0,

  async create(): Promise<Connection> {
    const sqliteConf = getSqliteConfig('testConnection' + this.numConnections++)
    return await createConnection(sqliteConf);
  },

  async close(connection: Connection): Promise<void>{
    await connection.close();
  },

  async clear(connection: Connection): Promise<void>{
    const entities = connection.entityMetadatas;

    await connection.transaction(async transactionEntityManager => {
      for (const entity of entities) {
        const repository = transactionEntityManager.connection.getRepository(entity.name);

        // Defer foreign key enforcement until transaction commits
        await repository.query("PRAGMA defer_foreign_keys=true");

        // Delete all entries in table
        await repository.query(`DELETE FROM ${entity.tableName}`);
      }
    })
  },
};
export default DBConnection;
