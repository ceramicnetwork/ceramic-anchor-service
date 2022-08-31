import {fetchJson} from '@ceramicnetwork/common'
import 'reflect-metadata'
import { Config } from 'node-config-ts'
import { inject, singleton } from 'tsyringe'
import { EventProducerService } from '../event-producer-service.js'

@singleton()
export class HTTPEventProducerService implements EventProducerService {
  constructor(@inject('config') private config?: Config) {}

  /**
   * Emits an anchor event by sending a message to the configured HTTP anchorLauncherUrl
   */
  public async emitAnchorEvent(body: string): Promise<void> {
    const payload = {
      type: 'anchor',
      data: body
    }
    await fetchJson(this.config.anchorLauncherUrl, {
      method: 'post',
      body: payload
    })
  }

  /**
   * Destroy underlying resources
   */
  public destroy(): void {}
}
