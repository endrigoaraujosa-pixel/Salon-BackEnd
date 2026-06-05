#!/usr/bin/env bash
commit=$(git rev-parse --short HEAD)


docker build -t salon-backend:$commit .
docker tag salon-backend:$commit salon-backend:latest
docker push salon-backend:$commit
docker push salon-backend:latest