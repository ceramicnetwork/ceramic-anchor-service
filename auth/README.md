# CAS DID Auth

> A Serverless application for DID based authentication over CAS

## New deployment

1. Make sure you have valid AWS credentials.
2. `pnpm install`
3. `pnpm run deploy`

## Offline

Instead of deploying to the cloud, you can run the API locally in offline mode.

1. Run dynamodb on port 8000
```sh
docker run -p 8000:8000 amazon/dynamodb-local
```
1. Run serverless offline
```sh
pnpm run start
```

> This will output the API endpoint you will call. Save this endpoint.

> Admin username and password are set to `admin` when in offline mode.

## Running

```shell
curl --request POST \
  --url <endpoint> \
  --header 'Content-Type: application/json' \
  --data '{}'
```

Request OTP
```sh
curl --request POST \
  --url https://cas-dev.3boxlabs.com/api/v0/auth/verification \
  --header 'Content-Type: application/json' \
  --data '{"email": "<email>"}'
```

Register DID
```sh
curl --request POST \
  --url https://cas-dev.3boxlabs.com/api/v0/auth/did \
  --header 'Content-Type: application/json' \
  --data '{"email": "<email>", "otp": "<otp>", "dids": ["<did>"]}'
```

Disable registrations
```sh
node ./scripts/build-credentials.js
```
```sh
curl --request PUT \
  --url https://cas-dev.3boxlabs.com/api/v0/auth/config \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Basic <credentials>' \
  --data '{"PK": "RegistrationEnabled", "v": false}'
```

Bypass registration config
```sh
node ./scripts/build-credentials.js
```
```sh
curl --request POST \
  --url https://cas-dev.3boxlabs.com/api/v0/auth/did \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Basic <credentials>' \
  --data '{"email": "<email>", "otp": "<anything>", "dids": ["<did>"]}'
```

Revoke DID
```sh
curl --request PATCH \
  --url https://cas-dev.3boxlabs.com/api/v0/auth/did/<did> \
  --header 'Content-Type: application/json' \
  --data '{"email": "<email>", "otp": "<otp>"}'
```

## Testing

1. Start dynamodb on port 8000, in one terminal
```sh
docker run -p 8000:8000 amazon/dynamodb-local
```

1. Start the API in testing mode, in another terminal
```sh
pnpm run start:testing
```

1. Run the tests
```sh
pnpm run test
```
