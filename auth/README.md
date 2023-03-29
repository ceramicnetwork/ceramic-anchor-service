# CAS DID Auth

> A Serverless application for DID based authentication over CAS

## Launch or update deployment

1. Make sure you have valid AWS credentials.
2. Retrieve the appropriate `.env.[ENV]` [cas-auth file from passbolt](https://3boxlabs.1password.com/vaults/wyiefdof4l55jtoqkdwswbssiy/tags/goqi3h46x6gdwllwbs6wzitqjq/lid64nvqzggluglf6vbjbl76ze)
3. `pnpm install`
4. `pnpm run deploy:[ENV]`

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
