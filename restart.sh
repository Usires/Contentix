#!/bin/bash
pkill -f "node.*contentix" 2>/dev/null
cd /home/dirk/contentix
node index.js &