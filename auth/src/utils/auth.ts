import { createHash } from 'crypto'
import { Joi } from 'express-validation'
import { DateTime } from 'luxon'
import { authBasicValidation } from '../validators/did.js'
import { now } from './datetime.js'

export const authBasicRegex = new RegExp(/Basic .*/)
export const authBearerRegex = new RegExp(/Bearer .*/)

export function checkUserIsAdmin(authorization: string) {
    if (!process.env.ADMIN_USERNAME || ! process.env.ADMIN_PASSWORD) {
        console.error('Missing admin credentials')
        return false
    }
    if (!authBasicRegex.test(authorization)) {
        console.log('Validation for Basic auth failed')
        return false
    }
    const credentials = authorization.split(' ')[1]
    const {username, password, expirationUnixTimestamp } = decodeAdminCredentials(credentials)

    if (expirationUnixTimestamp < now()) {
        console.error('Credentials expired')
        return false
    }

    const u = createHash('sha256').update(process.env.ADMIN_USERNAME).digest('hex')
    const p = createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')
    return (u == username) && (p == password)
}

export function decodeAdminCredentials(credentials: string): {
    username: string,
    password: string,
    expirationUnixTimestamp: number
} {
    const buf = Buffer.from(credentials, 'base64')
    const [front, password] = buf.toString().split(':')
    const [username, exp] = front.split('#')
    const expirationUnixTimestamp = Number(exp)
    if (isNaN(expirationUnixTimestamp)) {
        throw Error('Failed to decode credentials. Expiration is not a valid unix timestamp')
    }
    return { username, password, expirationUnixTimestamp}
}

/**
 * Encodes admin credentials for Basic authorization header.
 *
 * Defaults to expiring 4 hours from now. This can be overridden by setting `expirationUnixTimestamp`.
 * @param username
 * @param password
 * @param expirationUnixTimestamp Optional. Expiration time in seconds from epoch.
 */
export function encodeAdminCredentials(
    username: string,
    password: string,
    expirationUnixTimestamp?: number
): string {
    if (!expirationUnixTimestamp) {
        const date = DateTime.now().plus({ hours: 4 })
        expirationUnixTimestamp = date.toUnixInteger()
    }
    const u = createHash('sha256').update(username).digest('hex')
    const p = createHash('sha256').update(password).digest('hex')
    const credentials = `${u}#${expirationUnixTimestamp}:${p}`
    return Buffer.from(credentials).toString('base64')
}
