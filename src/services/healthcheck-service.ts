import { cpuFree, freememPercentage } from 'os-utils'
import { logger } from '../logger/index.js'

/**
 * Public interface for `HealthcheckService`
 */
export interface IHealthcheckService {
  isOK(): Promise<boolean>
}

/**
 * Tells if system is OK.
 */
export class HealthcheckService implements IHealthcheckService {
  freeCpu(): Promise<number> {
    return new Promise((resolve) => cpuFree(resolve))
  }

  freeMem() {
    return freememPercentage()
  }

  /**
   * Tell if system is OK.
   *
   * @return true - everything is okay, false - not okay
   */
  async isOK(): Promise<boolean> {
    try {
      const freeCpu = await this.freeCpu()
      const freeMem = this.freeMem()
      if (freeCpu < 0.05 || freeMem < 0.2) {
        logger.err(
          `Ceramic Anchor Service failed a healthcheck. Info: (freeCpu=${freeCpu}, freeMem=${freeMem})`
        )
        return false
      }
      return true
    } catch (err: any) {
      logger.err(`Failed to run healthcheck: ${err.message}`)
      return false
    }
  }
}
