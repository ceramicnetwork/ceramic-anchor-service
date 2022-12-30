import { createEmailVerificationCode, DatabaseEmailVerification } from '../services/db'

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
      _checkOTPExpired: jest.fn(),
      _expireOTP: jest.fn(() => {
        revokedOTPs.shift()
        return Promise.resolve()
      }),
      _revokeOTP: jest.fn((item) => {
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
    expect(db._revokeOTP).toHaveBeenCalledTimes(1)
    expect(db._addOTP).toHaveBeenCalledTimes(2)
    // 3
    await expect(db.createEmailVerificationCode(email)).rejects.toThrow('Must wait until existing codes expire')
    expect(db._expireOTP).toHaveBeenCalledTimes(0)
    expect(db._addOTP).toHaveBeenCalledTimes(2)
    // 4
    await expect(db.createEmailVerificationCode(email)).rejects.toThrow('Must wait until existing codes expire')
    expect(db._expireOTP).toHaveBeenCalledTimes(1)
    expect(db._addOTP).toHaveBeenCalledTimes(2)
    // 5
    await db.createEmailVerificationCode(email)
    expect(db._revokeOTP).toHaveBeenCalledTimes(2)
    expect(db._addOTP).toHaveBeenCalledTimes(3)
})