# Ceramic Anchor Service
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service?ref=badge_shield)


Ceramic Anchor Service is a proof of concept implementation of an anchor service according to the Ceramic [specification](https://github.com/ceramicnetwork/specs).

This implementation currently uses the Ethereum blockchain but is built in order to be blockchain agnostic. It is fairly easy to add more modules to support other blockchains as well.

## Usage (Docker)

### Docker

**Build the CAS image:**
```sh
docker build . -f Dockerfile -t cas
```

**Build the runner image (optional):**

The runner is only useful if running CAS with ECS.
It sends updates on the start and exit status of the container to Discord webhooks.
```sh
# First make sure your CAS image was tagged "cas"
# then build the runner (a wrapper around CAS)
docker build . -f Dockerfile.runner -t cas-runner

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

Configuration file is located under `./config` directory.

In order to build the application start the IPFS node locally and run the following commands:

```sh
npm run build
npm run start
```

## Running the tests

Tests are located in the `test` directory. In order to run test start the following command:

```
npm run test
```

In order to run tests with coverage run:

```
npm run coverage
```

## Maintainers
[@stephhuynh18](https://github.com/stephhuynh18)

## License

Apache-2.0 OR MIT

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fceramicnetwork%2Fceramic-anchor-service?ref=badge_large)

## Team

Built with  <img src="./resources/heart.png" width="20"/>  from the [3Box Labs](https://3box.io) team.
