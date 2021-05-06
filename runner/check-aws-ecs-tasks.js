const https = require('https')
const { ECSClient, ListTasksCommand } = require('@aws-sdk/client-ecs')

async function main() {

  const client = new ECSClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  })

  const params = {
    cluster: process.env.AWS_ECS_CLUSTER,
    family: process.env.AWS_ECS_FAMILY
  }

  const command = new ListTasksCommand(params)

  const data = await client.send(command)

  if (data.$metadata.httpStatusCode > 399) {
    throw Error(data.$metadata.httpStatusCode)
  } else {
    if (data.taskArns.length > 1) {
      console.log('HALT')
      console.log('More than one task already running')
      console.log(data.taskArns)
      const retryDelayMs = 300000 // 300k ms = 5 mins
      sendNotification(data.taskArns, retryDelayMs)
    } else {
      console.log('OK')
      console.log('Only one running task found (assumed to be self)')
    }
  }
}

function sendNotification(taskArns, retryDelayMs = -1) {
  const url = process.env.DISCORD_WEBHOOK_URL
  const options = {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
    }
  }
  const arnRegex = /\w+$/
  const fields = taskArns.map((arn, index) => {
    let value = arn
    const id = arn.match(arnRegex)
    if (id) {
      value = `${process.env.CLOUDWATCH_LOG_BASE_URL}/${id[0]}`
    }
    return { name: `Task ${index}`, value }
  })
  const message = [
    {
      title: 'CAS still running',
      description: `A new CAS anchor task was not started because there is already at least one running.`,
      color: 16776960,
      fields,
    },
  ]
  const data = { embeds: message, username: 'cas-runner' }

  const req = https.request(url, options, (res) => {
    console.log(`Notification request status code: ${res.statusCode}`)
    if (res.statusCode >= 500 && retryDelayMs > -1) {
      console.log(`Retrying after ${retryDelayMs} milliseconds...`)
      setTimeout(() => {
        sendNotification(taskArns)
      }, retryDelayMs)
    }
  })
  req.on('error', console.error)
  req.write(JSON.stringify(data))
  req.end()
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
