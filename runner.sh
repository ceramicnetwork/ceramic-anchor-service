#!/bin/bash

export TASKS="$(node ./runner/check-aws-ecs-tasks.js)"
echo $TASKS

STATUS=($TASKS)
if [[ ${STATUS[0]} == "OK" ]]; then
  cd $CAS_PATH && npm run start
  exit_code=$?
  if [[ $exit_code != 0 ]]; then
    node ./runner/report-exit.js
    echo "CAS exited with non-zero exit code"
  fi
fi

