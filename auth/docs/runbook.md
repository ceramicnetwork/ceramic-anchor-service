# Disable new sign ups

pnpm run deploy:disable-registration

## Admin override
Send the correct admin credentials in the Authorization header to be able to register anyway

```sh
export ADMIN_USERNAME=<un>
export ADMIN_PASSWORD=<pw>
pnpm run admin:build-credentials
```

```sh
curl --request POST \
  --url https://cas-dev.3boxlabs.com/api/v0/auth/did/register \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <credentials>' \
  --data '{"email": "<email>", "dids": ["<did>"]}'
```

## Re-enable new sign ups

pnpm run deploy
