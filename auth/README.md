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
sls offline
```


## Running

```shell
curl --request GET \
  --url <<endpoint>> \
  --header 'Content-Type: application/json' \
  --data '{
        "did": <any_did>
  }'
```
