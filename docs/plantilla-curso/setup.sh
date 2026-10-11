#!/usr/bin/env bash
# Setup de la plantilla. Reglas: solo lectura/creación dentro de TUTOR_WORKSPACE, sin sudo, sin red.
set -euo pipefail

WS="${TUTOR_WORKSPACE:-$PWD}"

command -v python3 >/dev/null || { echo "ERROR: falta python3 (ver MANUAL.md)"; exit 1; }
python3 --version

mkdir -p "$WS/mi-curso"
echo "Listo: carpeta de trabajo preparada en $WS/mi-curso"
