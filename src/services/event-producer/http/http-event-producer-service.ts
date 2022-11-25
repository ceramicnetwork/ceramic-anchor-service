import { fetchJson } from '@ceramicnetwork/common'
import 'reflect-metadata'
import type { Config } from 'node-config-ts'
import type { EventProducerService } from '../event-producer-service.js'

export class HTTPEventProducerService implements EventProducerService {
  static inject = ['config'] as const

  constructor(private readonly config: Config) {}

  /**
   * Emits an anchor event by sending a message to the configured HTTP anchorLauncherUrl
   */
  public async emitAnchorEvent(body: string): Promise<void> {
    const payload = {
      type: 'anchor',
      data: body,
    }
    await fetchJson(this.config.anchorLauncherUrl, {
      method: 'post',
      body: payload,
    })
  }

  /**
   * Destroy underlying resources
   */
  public destroy(): void {}
}
