# Ceramic Anchor Service
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service?ref=badge_shield)

Ceramic Anchor Service is a proof of concept implementation of an anchor service according to the Ceramic [specification](https://github.com/ceramicnetwork/specs).

This implementation currently uses the Ethereum blockchain but is built in order to be blockchain agnostic. It is fairly easy to add more modules to support other blockchains as well.

## Usage (Docker)

### Docker

**Build the CAS image:**
```sh
docker build . --target base -t cas
```

**Build the runner image (optional):**

The runner is only useful if running CAS with ECS.
It sends updates on the start and exit status of the container to Discord webhooks.
```sh
docker build . --target runner -t cas-runner

docker run cas-runner

# Test the runner with Discord by using test
# webhooks instead of the actual alert channels.
docker run -e DISCORD_WEBHOOK_URL_INFO_CAS="<test_webhook_url>" -e DISCORD_WEBHOOK_URL_ALERTS="<test_webhook_url>" cas-runner
```

### Docker Compose

Docker compose will run two instances of CAS--the api in "server" mode and the anchor worker in "anchor" mode.

```sh
docker compose up
docker compose down
```

## Usage (Node.js)

In order to run the simulation you need to install [Node.js](https://nodejs.org).
Only major version 16 of Node.js is supported.

Configuration file is located under `./config` directory.

In order to run the application, you need to start the IPFS, Ganache, Postgres nodes locally.

You could do that by running:
```shell
docker-compose up ipfs ganache database
```

Then run the following commands in a new terminal:

```sh
npm run build
npm run start
```

## Testing

1. Install node modules by running `npm install`
1. Compile smart contracts
    1. Install [foundry](https://github.com/foundry-rs/foundry)
    1. `npm run installContractDeps`
    1. `npm run buildContract`
1. Run the tests: `npm run test`
1. (Optional) Run tests with coverage: `npm run coverage`

## Contributing

### Config

Values in the config files get their types auto-generated by [node-config-ts](https://github.com/tusharmath/node-config-ts) when running `npm run postinstall`.

## Maintainers
[@stephhuynh18](https://github.com/stephhuynh18)

## License

Apache-2.0 OR MIT

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service?ref=badge_large)

## Team

Built with  <img src="./resources/heart.png" width="20"/>  from the [3Box Labs](https://3box.io) team.
