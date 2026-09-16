#!/bin/bash
# Compila todos los .applescript a build/*.scpt (usables con streamdeck-osascript,
# Atajos, Automator, `osascript build/x.scpt`, etc.).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
for f in *.applescript; do
  osacompile -o "build/${f%.applescript}.scpt" "$f"
done
echo "Compilados en $(pwd)/build:"; ls build
