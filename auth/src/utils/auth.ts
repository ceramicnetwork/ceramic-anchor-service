import { createHash } from "crypto"
import { DateTime } from "luxon"
import { authBasicValidation } from "../validators/did"
import { now } from "./datetime"

export const authBasicRegex = new RegExp(/Basic .*/)
export const authBearerRegex = new RegExp(/Bearer .*/)

export function checkUserIsAdmin(authorization: string) {
    if (!process.env.ADMIN_USERNAME || ! process.env.ADMIN_PASSWORD) {
        console.error('Missing admin credentials')
        return false
    }
    const {error, value} = authBasicValidation.validate(authorization)
    if (error) {
        console.log(error)
        return false
    }
    const credentials = authorization.split(' ')[1]
    const buf = Buffer.from(credentials, 'base64')
    const [username, password] = buf.toString().split(':')

    const expires = username.split('#')[1]
    if (Number(expires) < now()) {
        console.error('Credentials expired')
        return false
    }

    const u = createHash('sha256').update(process.env.ADMIN_USERNAME).digest('hex')
    const p = createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')
    return (u == username) && (p == password)
}
