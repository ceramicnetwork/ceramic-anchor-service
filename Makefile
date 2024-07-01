# Makefile provides an API for CI related tasks
# Using the makefile is not required however CI
# uses the specific targets within the file.
# Therefore may be useful in ensuring a change
# is ready to pass CI checks.

# ECS environment to deploy image to
DEPLOY_ENV ?= dev

# Deploy target to use for CD manager job
DEPLOY_TARGET ?= latest

# Docker image tag to deploy
DEPLOY_TAG ?= latest

# Whether or not this is a manual deployment
MANUAL_DEPLOY ?= false

.PHONY: publish-docker
publish-docker:
	./ci-scripts/publish.sh

.PHONY: schedule-ecs-deployment
schedule-ecs-deployment:
	./ci-scripts/schedule_ecs_deploy.sh "${DEPLOY_ENV}" "${DEPLOY_TARGET}" "${DEPLOY_TAG}" "${MANUAL_DEPLOY}"
