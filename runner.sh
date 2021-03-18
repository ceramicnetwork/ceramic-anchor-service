#!/bin/sh

export TASKS="$(node ./runner/check-aws-ecs-tasks.js)"

if [[ $TASKS == 0 ]]; then
  cd $CAS_PATH && npm run start
  exit_code=$?
  if [[ $exit_code != 0 ]]; then
    echo 'failed'
  fi
else
  echo $TASKS
fi
