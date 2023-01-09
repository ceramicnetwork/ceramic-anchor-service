import { VerificationUnavailableError } from "../utils/errorHandling"
import { generateOTP } from "../utils/otp"

export enum DIDStatus {
    Active = 'Active',
    Revoked = 'Revoked'
}

export enum OTPStatus {
    Active = 'Active',
    Revoked = 'Revoked',
    Expired = 'Expired',
    Used = 'Used'
}

export interface Database {
    name: string
    client: any
    init: () => Promise<void>
    createEmailVerificationCode: (email: string) => Promise<string | undefined>
    getDIDRegistration: (did: string) => Promise<any>
    getEmail: (did: string) => Promise<string | undefined>
    getNonce: (did: string) => Promise<number | undefined>
    updateNonce: (did: string, nonce: number) => Promise<boolean>
    registerDID: (email: string, otp: string, did: string) => Promise<any>
    registerDIDs: (email: string, otp: string, dids: Array<string>) => Promise<any>
    revokeDID: (email: string, otp: string, did: string) => Promise<any>
}

export interface DatabaseEmailVerification {
    _addOTP: (email: string, otp: string) => Promise<void>
    _checkOTPExpired: (item: any) => boolean
    _expireOTP: (item: any) => Promise<void>
    _getActiveOTPs: (email: string) => Promise<Array<any>>
    _getRevokedOTPs: (email: string) => Promise<Array<any>>
    _revokeOTP: (item: any) => Promise<void>
}

/**
 * Creates an email verification code in the database
 * @param email Email address the code will be sent to
 * @param db Database that will use this implementation
 * @returns Code to send to the provided email address
 */
export async function createEmailVerificationCode(email: string, db: DatabaseEmailVerification): Promise<string> {
    const revokedOTPs = await db._getRevokedOTPs(email)
    if (revokedOTPs.length > 0) {
        for (let result of revokedOTPs) {
            if (db._checkOTPExpired(result)) {
                await db._expireOTP(result)
            }
        }
        throw new VerificationUnavailableError('Must wait until existing codes expire')
    }
    const activeOTPs = await db._getActiveOTPs(email)
    if (activeOTPs.length > 0) {
        for (let activeOTP of activeOTPs) {
            await db._revokeOTP(activeOTP)
        }
    }
    const otp = generateOTP()
    await db._addOTP(email, otp)
    return otp
}
