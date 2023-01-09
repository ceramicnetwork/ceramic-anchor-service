import { SES } from 'aws-sdk'
import { EmailService } from '../email'

export class SESService implements EmailService {
    readonly client: SES

    constructor() {
        this.client = new SES()
    }

    async init(): Promise<void> {}

    async sendVerificationCode(email: string, secret: string): Promise<void> {
        const message = {
            Body: {
                Html: {
                    Charset: 'UTF-8',
                    Data: `<html><body><p>This is your secret verification code. It will expire in 30 minutes:</p>
                           <h3>${secret}</h3></body></html>`
                },
                Text: {
                    Charset: 'UTF-8',
                    Data: `Your secret verification code: ${secret}`
                }
            },
            Subject: {
                Charset: 'UTF-8',
                Data: 'Ceramic Anchor Service verification code'
            }
        }
        const sender = "no-reply@3boxlabs.com"
        await this._sendEmail([email], message, sender)
    }

    private async _sendEmail(recipients: Array<string>, message: SES.Message, sender: string): Promise<void> {
        if (process.env.TESTING == 'true') return
        const params: SES.SendEmailRequest = {
            Destination: { ToAddresses: recipients },
            Message: message,
            Source: sender
        }
        await this.client.sendEmail(params).promise()
    }
}
