const { generateDiscordCloudwatchFields, listECSTasks, sendDiscordNotification } = require('./helpers')

async function main() {

  const taskArns = await listECSTasks()

  if (taskArns.length > 1) {
    console.log('HALT')
    console.log('More than one task already running')
    console.log(taskArns)
    sendHangingNotification(taskArns)
  } else {
    console.log('OK')
    console.log('Only one running task found (assumed to be self)')
    // Only do this in prod because it's too noisy given the short interval of
    // tnet and dev anchoring
    sendStartNotification(taskArns)
  }
}

function sendHangingNotification(taskArns) {
  const fields = generateDiscordCloudwatchFields(taskArns)
  const message = [
    {
      title: `CAS still running (${process.env.AWS_ECS_CLUSTER})`,
      description: `A new CAS anchor task was not started because there is already at least one running.`,
      color: 16776960, // Yellow
      fields,
    },
  ]
  const data = { embeds: message, username: 'cas-runner' }
  const retryDelayMs = 300000 // 300k ms = 5 mins
  if (process.env.AWS_ECS_CLUSTER.includes('prod')) {
    sendDiscordNotification(process.env.DISCORD_WEBHOOK_URL_ALERTS, data, retryDelayMs)
  } else {
    sendDiscordNotification(process.env.DISCORD_WEBHOOK_URL_WARNINGS, data, retryDelayMs)
  }
}

function sendStartNotification(taskArns) {
    const fields = generateDiscordCloudwatchFields(taskArns)
    const message = [
        {
            title: `CAS anchor task started (${process.env.AWS_ECS_CLUSTER})`,
            description: '',
            color: 3447003, // Blue
            fields,
        },
    ]
    const data = { embeds: message, username: 'cas-runner'}
    const retryDelayMs = 300000 // 300k ms = 5 mins
    sendDiscordNotification(process.env.DISCORD_WEBHOOK_URL_INFO_CAS, data, retryDelayMs)
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
