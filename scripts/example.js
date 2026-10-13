#!/usr/bin/env node
// Levanta el repositorio de ejemplo y abre el editor con la extensión sobre examples/workspace.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { start } = require('./serve-examples');

// el repositorio local es opcional: sin examples/repo la vista Buscar usa el repositorio de GitHub
const hasRepo = fs.existsSync(path.join(__dirname, '..', 'examples', 'repo', 'catalogo.json'));
const server = hasRepo ? start() : { close() {} };
if (!hasRepo) console.log('Sin examples/repo: los cursos se listan desde GitHub (tutor.repoGithub).');
const ide = spawnSync(process.execPath, [path.join(__dirname, 'ide.js'), 'example'], { stdio: 'inherit' });
if (ide.status !== 0) {
  server.close();
  process.exit(ide.status ?? 1);
}
console.log(hasRepo ? 'Editor lanzado. Deja esta terminal abierta mientras pruebas las descargas.' : 'Editor lanzado.');
if (!hasRepo) process.exit(0);
