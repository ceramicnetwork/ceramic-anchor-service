const { generateDiscordCloudwatchFields, sendDiscordNotification, listECSTasks } = require('./helpers')

async function main() {
  const taskArns = await listECSTasks()
  const fields = generateDiscordCloudwatchFields(taskArns)
  const message = [
    {
      title: `CAS failed (${process.env.AWS_ECS_CLUSTER})`,
      color: 16711712, // Red
      fields,
    },
  ]
  const data = { embeds: message, username: 'cas-runner' }
  const retryDelayMs = 300000 // 300k ms = 5 mins
  sendDiscordNotification(process.env.DISCORD_WEBHOOK_URL_ALERTS, data, retryDelayMs)
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
