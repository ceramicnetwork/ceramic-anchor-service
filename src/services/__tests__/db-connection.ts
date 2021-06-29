import { Connection, ConnectionOptions, createConnection, getConnection } from 'typeorm';
import { Anchor } from "../../models/anchor";
import { Request } from "../../models/request";

const sqliteConf : ConnectionOptions = {
  type: "sqlite",
  database: ":memory:",
  entities: [Request, Anchor],
  synchronize: true,
  logging: false,
  dropSchema: true,
};

const DBConnection = {
  async create(): Promise<Connection> {
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
