const { generateDiscordCloudwatchFields, listECSTasks, sendDiscordNotification } = require('./helpers')

async function main() {

  const taskArns = await listECSTasks()

  if (taskArns.length > 1) {
    console.log('HALT')
    console.log('More than one task already running')
    console.log(taskArns)
    sendNotification(taskArns)
  } else {
    console.log('OK')
    console.log('Only one running task found (assumed to be self)')
  }
}

function sendNotification(taskArns) {
  const fields = generateDiscordCloudwatchFields(taskArns)
  const message = [
    {
      title: `CAS still running (${process.env.AWS_ECS_CLUSTER})`,
      description: `A new CAS anchor task was not started because there is already at least one running.`,
      color: 16776960,
      fields,
    },
  ]
  const data = { embeds: message, username: 'cas-runner' }
  const retryDelayMs = 300000 // 300k ms = 5 mins
  sendDiscordNotification(process.env.CHECK_TASKS_DISCORD_WEBHOOK_URL, data, retryDelayMs)
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
