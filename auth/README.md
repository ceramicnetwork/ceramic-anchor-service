# CAS DID Auth

> A Serverless application for DID based authentication over CAS

## New deployment

1. Make sure you have valid AWS credentials.
2. `pnpm install`
3. `pnpm run deploy`

This will output the API endpoint you will cal. Save this endpoint.

## Offline

1. Run dynamodb on port 8000
```sh
docker run -p 8000:8000 amazon/dynamodb-local
```
1. Run serverless offline
```sh
pnpm run start
```

> Admin username and password are set to `admin` when in offline mode.

## Testing

Add the env var `TESTING` is set to true to run integration tests
```sh
pnpm run start:testing
# in another terminal
pnpm run test -- integration
```


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