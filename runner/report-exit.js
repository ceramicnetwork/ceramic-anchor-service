const { generateDiscordCloudwatchFields, sendDiscordNotification, listECSTasks } = require('./helpers')

async function main() {
  // Only do this in prod because it's too noisy given the short interval of
  // tnet and dev anchoring
  const taskArns = await listECSTasks()
  const fields = generateDiscordCloudwatchFields(taskArns)
  const message = [
      {
      title: `CAS anchor task finished (${process.env.AWS_ECS_CLUSTER})`,
      color: 3447003, // Blue
      fields,
      },
  ]
  const data = { embeds: message, username: 'cas-runner' }
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
