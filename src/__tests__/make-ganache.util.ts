import Ganache from 'ganache-core'
import getPort from 'get-port'

const BLOCKCHAIN_START_TIME = new Date('2020-04-13T13:20:02.000Z')

export type GanacheServer = {
  server: Ganache.Server
  port: number
  url: URL
  close: () => Promise<void>
}

export async function makeGanache(): Promise<GanacheServer> {
  const port = await getPort()
  const ganacheServer = Ganache.server({
    gasLimit: 7000000,
    time: BLOCKCHAIN_START_TIME,
    mnemonic: 'move sense much taxi wave hurry recall stairs thank brother nut woman',
    default_balance_ether: 100,
    debug: true,
    blockTime: 2,
    network_id: 1337,
    networkId: 1337,
  })

  await ganacheServer.listen(port)
  return {
    server: ganacheServer,
    port: port,
    url: new URL(`http://localhost:${port}/`),
    close: () =>
      new Promise((resolve, reject) => {
        ganacheServer.close((error) => {
          error ? reject(error) : resolve()
        })
      }),
  }
}
