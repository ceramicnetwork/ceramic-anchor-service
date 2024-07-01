#!/usr/bin/env bash

# Build and publish a docker image run running cas
#
# DOCKER_PASSWORD must be set
# Use:
#
#   export DOCKER_PASSWORD=$(aws ecr-public get-login-password --region us-east-1)
#   echo "${DOCKER_PASSWORD}" | docker login --username AWS --password-stdin public.ecr.aws/r5b3e0r5
#
# to login to docker. That password will be valid for 12h.

docker buildx build --load -t 3box/cas .

if [[ -n "$SHA" ]]; then
  docker tag 3box/cas:latest public.ecr.aws/r5b3e0r5/3box/cas:"$SHA"
fi
if [[ -n "$SHA_TAG" ]]; then
  docker tag 3box/cas:latest public.ecr.aws/r5b3e0r5/3box/cas:"$SHA_TAG"
fi
if [[ -n "$RELEASE_TAG" ]]; then
  docker tag 3box/cas:latest public.ecr.aws/r5b3e0r5/3box/cas:"$RELEASE_TAG"
fi
if [[ "$TAG_LATEST" == "true" ]]; then
  docker tag 3box/cas:latest public.ecr.aws/r5b3e0r5/3box/cas:latest
fi
if [[ -n "$CUSTOM_TAG" ]]; then
  docker tag 3box/cas:latest public.ecr.aws/r5b3e0r5/3box/cas:"$CUSTOM_TAG"
fi

docker push -a public.ecr.aws/r5b3e0r5/3box/cas
