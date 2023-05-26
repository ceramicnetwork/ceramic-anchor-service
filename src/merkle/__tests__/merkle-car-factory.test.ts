import { test, expect, describe } from '@jest/globals'
import { CARIpfsService } from '../merkle-car-factory.js'
import { CAR } from 'cartonne'

describe('CARIpfsService', () => {
  test('create CAR file', () => {
    const service = new CARIpfsService()
    expect(service.car).toBeInstanceOf(CAR)
    expect(service.car.version).toEqual(1)
  })

  test('populate CAR file', async () => {
    const service = new CARIpfsService()
    const car = service.car
    const cid = await service.storeRecord({ data: 1 })
    expect(car.roots.length).toEqual(0)
    expect(car.blocks.size).toEqual(1)
    expect(car.get(cid)).toEqual({ data: 1 })
  })
})
