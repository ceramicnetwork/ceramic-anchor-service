import { describe, expect, test } from '@jest/globals'
import { HealthcheckService } from '../healthcheck-service.js'

const HEALTHY = 0.9 // 90% free

describe('isOK', () => {
  test('free cpu and mem over threshold', async () => {
    const service = new HealthcheckService()
    service.freeCpu = async () => HEALTHY
    service.freeMem = () => HEALTHY
    await expect(service.isOK()).resolves.toBeTruthy()
  })
  test('free cpu under threshold', async () => {
    const service = new HealthcheckService()
    service.freeCpu = async () => 0.01 // CPU is busy
    service.freeMem = () => HEALTHY
    await expect(service.isOK()).resolves.toBeFalsy()
  })
  test('free mem under threshold', async () => {
    const service = new HealthcheckService()
    service.freeCpu = async () => HEALTHY
    service.freeMem = () => 0.01 // Memory is occupied
    await expect(service.isOK()).resolves.toBeFalsy()
  })
  test('error during gathering machine info', async () => {
    const service = new HealthcheckService()
    service.freeCpu = () => Promise.reject(new Error(`Can not get machine info`))
    service.freeMem = () => HEALTHY
    await expect(service.isOK()).resolves.toBeFalsy()
  })
})
