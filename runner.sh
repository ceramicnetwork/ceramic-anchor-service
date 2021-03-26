#!/bin/bash

export TASKS="$(node ./runner/check-aws-ecs-tasks.js)"
echo $TASKS

if [[ $TASKS == "SELF" ]]; then
  cd $CAS_PATH && npm run start
  exit_code=$?
  if [[ $exit_code != 0 ]]; then
    echo "Service exited with non-zero exit code"
  fi
fi

