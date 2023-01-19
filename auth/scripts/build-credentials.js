const { createHash } = require("crypto")

function main() {
    if (process.env.ADMIN_PASSWORD && process.env.ADMIN_USERNAME) {
        const date = new Date()
        date.setHours(date.getHours() + 4)
        const exp = Math.floor(date.getTime() / 1000)
        const credentials = buildCredentials(
            process.env.ADMIN_USERNAME,
            process.env.ADMIN_PASSWORD,
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
