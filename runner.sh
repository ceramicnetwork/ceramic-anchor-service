#!/bin/bash

export TASK="$(node ./runner/report-start.js)"
echo $TASK

STATUS=($TASK)
if [[ ${STATUS[0]} == "OK" ]]; then
  cd $CAS_PATH && npm run start
  exit_code=$?
  if [[ $exit_code != 0 ]]; then
    cd $HOME && cd .. && node ./runner/report-failure.js
    echo "Service exited with non-zero exit code"
  else
    cd $HOME && cd .. && node ./runner/report-exit.js
    echo "Service exited cleanly"
  fi
else
  echo "Runner encountered an unexpected failure"
fi
