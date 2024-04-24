#!/bin/bash

instance_uri=$ECS_CONTAINER_METADATA_URI

# Parse the last portion of the URI
instance_id=${instance_uri##*/}

# Remove everything after the hyphen to get the task ID
instance_id=${instance_id%%-*}

# if present, will be the task ID, otherwise empty string
export INSTANCE_IDENTIFIER=$instance_id

exec "$@"
