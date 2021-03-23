#!/bin/bash

export TASKS="$(node ./runner/check-aws-ecs-tasks.js)"
echo $TASKS

if [[ $TASKS == "No running tasks found" ]]; then
  cd $CAS_PATH && npm run start
  EC=$?
  if [[ $EC != 0 ]]; then
    echo "Service exited with non-zero exit code"
  fi
fi

