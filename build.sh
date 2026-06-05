#!/usr/bin/env bash
user=$1
commit=$(git rev-parse --short HEAD)


docker build -t $user/salon-backend:$commit .
docker tag $user/salon-backend:$commit $user/salon-backend:latest
docker push $user/salon-backend:$commit
docker push $user/salon-backend:latest