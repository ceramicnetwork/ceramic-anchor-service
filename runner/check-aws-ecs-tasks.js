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

  try {
    const data = await client.send(command)
    if (data.$metadata.httpStatusCode > 399) {
      throw Error(data.$metadata.httpStatusCode)
    } else {
      if (data.taskArns.length > 0) {
        console.log(data.taskArns)
      } else {
        console.log(0)
      }
    }
  } catch (error) {
    console.error(error)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
