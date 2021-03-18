#!/bin/bash

export TASKS="$(node ./runner/check-aws-ecs-tasks.js)"

if [[ $TASKS == 0 ]]; then
  cd $CAS_PATH && npm run start
  exit_code=$?
  if [[ $exit_code != 0 ]]; then
    echo "Service exited with non-zero exit code"
  fi
else
  exit_code=$?
  if [[ $exit_code != 0 ]]; then
    echo "Failed to retrieve running tasks"
  else
  echo "Service is already running tasks"
  echo $TASKS
  fi
fi
