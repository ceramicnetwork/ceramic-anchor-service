import * as https from 'https'
import { ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs'

/**
 * Returns kv object for Discord fields
 * @param {Array<string>} taskArns
 * @returns {object}
 */
function generateDiscordCloudwatchFields(taskArns) {
  const arnRegex = /\w+$/
  const fields = taskArns.map((arn, index) => {
    let value = arn
    const id = arn.match(arnRegex)
    if (id) {
      value = `${process.env.CLOUDWATCH_LOG_BASE_URL}${id[0]}`
    }
    return { name: `Task ${index}`, value }
  })
  return fields
}

/**
 * Returns list of running ECS anchor tasks
 * @returns {Array<string>}
 */
async function listECSTasks() {
  const client = new ECSClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  })

  const params = {
    cluster: process.env.AWS_ECS_CLUSTER,
    family: process.env.AWS_ECS_FAMILY,
  }

  const command = new ListTasksCommand(params)

  const data = await client.send(command)

  if (data.$metadata.httpStatusCode > 399) {
    throw Error(data.$metadata.httpStatusCode)
  } else {
    return data.taskArns
  }
}

/**
 * Sends a POST to the discord webhookUrl
 * @param {string} webhookUrl Discord webhook url
 * @param {any} data POST data
 * @param {Number} retryDelayMs If -1, will not retry, otherwise the millisecond delay before 1 retry
 */
function sendDiscordNotification(webhookUrl, data, retryDelayMs = -1) {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }
  const req = https.request(webhookUrl, options, (res) => {
    console.log(`Notification request status code: ${res.statusCode}`)
    if (res.statusCode >= 500 && retryDelayMs > -1) {
      console.log(`Retrying after ${retryDelayMs} milliseconds...`)
      setTimeout(() => {
        sendDiscordNotification(webhookUrl, data)
      }, retryDelayMs)
    }
  })
  req.on('error', console.error)
  req.write(JSON.stringify(data))
  req.end()
}

module.exports = {
  generateDiscordCloudwatchFields,
  listECSTasks,
  sendDiscordNotification,
}
