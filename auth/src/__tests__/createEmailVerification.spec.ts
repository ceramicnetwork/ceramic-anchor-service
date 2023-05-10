import { createEmailVerificationCode, DatabaseEmailVerification } from '../services/db'
import { jest } from '@jest/globals'

test('createEmailVerification', async () => {
    const activeOTPs: any[] = []
    const revokedOTPs: any[] = []

    interface TestDb extends DatabaseEmailVerification {
      createEmailVerificationCode: any
    }

    let db: TestDb = {
      createEmailVerificationCode: async function (email: string) {
        await createEmailVerificationCode(email, db)
      },
      _getActiveOTPs: jest.fn(() => {
        return Promise.resolve(activeOTPs)
      }),
      _getRevokedOTPs: jest.fn(() => {
        return Promise.resolve(revokedOTPs)
      }),
      _checkOTPExpired: jest.fn((item) => {
        return false
      }),
      _expireOTP: jest.fn(() => {
        revokedOTPs.shift()
        return Promise.resolve()
      }),
      _revokeOTP: jest.fn((item: any) => {
        activeOTPs.shift()
        revokedOTPs.push(item.otp)
        return Promise.resolve()
      }),
      _addOTP: jest.fn((email, otp) => {
        activeOTPs.push({otp})
        return Promise.resolve()
      })
    }
    jest.spyOn(db, '_checkOTPExpired')
      .mockImplementationOnce(() => {
        return false
      })
      .mockImplementationOnce(() => {
        return true
      })

    const email = 'memail@wemail.bemail'

    // 1
    await db.createEmailVerificationCode(email)
    expect(db._addOTP).toHaveBeenCalledTimes(1)
    // 2
    await db.createEmailVerificationCode(email)
    expect(db._expireOTP).toHaveBeenCalledTimes(1)
    expect(db._addOTP).toHaveBeenCalledTimes(2)
})
