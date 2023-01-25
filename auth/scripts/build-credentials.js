const { createHash } = require("crypto")

function main() {
    if (process.env.CAS_AUTH_ADMIN_PASSWORD && process.env.CAS_AUTH_ADMIN_USERNAME) {
        const date = new Date()
        date.setHours(date.getHours() + 4)
        const exp = Math.floor(date.getTime() / 1000)
        const credentials = buildCredentials(
            process.env.CAS_AUTH_ADMIN_USERNAME,
            process.env.CAS_AUTH_ADMIN_PASSWORD,
            exp
        )
        console.log(credentials)
    } else {
        console.error('Missing admin credentials')
    }
}

function buildCredentials(username, password, expirationUnixTimestamp) {
    const u = createHash('sha256').update(username).digest('hex')
    const p = createHash('sha256').update(password).digest('hex')
    const credentials = `${u}#${expirationUnixTimestamp}:${p}`
    return Buffer.from(credentials).toString('base64')
}

main()
