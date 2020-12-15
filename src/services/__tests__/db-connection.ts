import { ConnectionOptions, createConnection, getConnection } from "typeorm";
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
  async create(): Promise<void> {
    await createConnection(sqliteConf);
  },

  async close(): Promise<void>{
    await getConnection().close();
  },

  async clear(): Promise<void>{
    const connection = getConnection();
    const entities = connection.entityMetadatas;

    await connection.transaction(async transactionEntityManager => {
      for (const entity of entities) {
        const repository = transactionEntityManager.connection.getRepository(entity.name);
        await repository.query("PRAGMA defer_foreign_keys=true");
        await repository.query(`DELETE FROM ${entity.tableName}`);
      }
    })
  },
};
export default DBConnection;
