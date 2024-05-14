#!/bin/bash

export LOGS="$(node ./runner/report-start.js)"
echo $LOGS

LOGS=($LOGS)
if [[ ${LOGS[0]} == "OK" ]]; then
  npm run start
  exit_code=$?
  if [[ $exit_code != 0 ]]; then
    node ./runner/report-failure.js
    echo "Service exited with non-zero exit code"
  else
    node ./runner/report-exit.js
    echo "Service exited cleanly"
  fi
else
  echo "Runner encountered an unexpected failure"
fi
