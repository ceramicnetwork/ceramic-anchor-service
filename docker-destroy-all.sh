#!/bin/bash
# Stop all containers
containers=$(docker ps -a -q)
if [ -n "$containers" ] ; then
        docker stop $containers
fi
# Delete all containers
containers=$(docker ps -a -q)
if [ -n "$containers" ]; then
        docker rm -f -v $containers
fi
# Delete all images
images=$(docker images -q -a)
if [ -n "$images" ]; then
        docker rmi -f $images
fi