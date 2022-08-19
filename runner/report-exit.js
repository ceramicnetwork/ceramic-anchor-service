import {
  reportTask,
} from './helpers.js'

async function main() {
  const messageWithoutFields = [
    {
      title: `CAS anchor task finished (${process.env.AWS_ECS_CLUSTER})`,
      color: 3447003, // Blue
    },
  ]
  reportTask(messageWithoutFields)
}

main()
  .then(() => {
    console.log('Done')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
