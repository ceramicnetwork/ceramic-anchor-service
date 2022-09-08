import { Utils } from '../utils.js'

describe('simple test of utils', () => {
  test('average array', async () => {

    const arr = [1,10,4]
    const avg = Utils.averageArray(arr)
    expect(avg).toEqual(5)

  })
})
