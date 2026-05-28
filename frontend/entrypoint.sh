#!/bin/sh
set -e

if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/next" ]; then
  echo "Installing dependencies..."
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
else
  echo "Dependencies already installed, skipping..."
fi

exec "$@"
