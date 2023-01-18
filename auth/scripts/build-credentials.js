const { createHash } = require("crypto")

function main() {
    if (process.env.ADMIN_PASSWORD && process.env.ADMIN_USERNAME) {
        const date = new Date()
        date.setHours(date.getHours() + 4)
        const exp = Math.floor(date.getTime() / 1000)
        const u = createHash('sha256').update(`${process.env.ADMIN_USERNAME}#${exp}`).digest('hex')
        const p = createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')
        const credentials = `${u}:${p}`
        console.log(Buffer.from(credentials).toString('base64'))
    } else {
        console.error('Missing admin credentials')
    }
}

main()
