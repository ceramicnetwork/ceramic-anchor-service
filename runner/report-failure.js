import {
  REPORTING_LEVEL,
  reportTask,
} from './helpers.js'

async function main() {
  const messageWithoutFields = [
    {
      title: `CAS failed (${process.env.AWS_ECS_CLUSTER})`,
      color: 16711712, // Red
    },
  ]
  reportTask(messageWithoutFields, REPORTING_LEVEL.error)
}

main()
  .then(() => {
    console.log('Done')
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
