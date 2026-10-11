#!/usr/bin/env node
// Uso: node scripts/validate-course.js <carpeta-del-curso> [...]  (sale con 1 si hay errores)
const path = require('path');
const { validateCourseDir, formatIssues } = require('../out/validator');

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('Uso: node scripts/validate-course.js <carpeta-del-curso> [...]');
  process.exit(2);
}
let failed = false;
for (const d of dirs) {
  const issues = validateCourseDir(path.resolve(d));
  console.log(`\n== ${d} ==\n${formatIssues(issues)}`);
  if (issues.some((i) => i.nivel === 'error')) failed = true;
}
process.exit(failed ? 1 : 0);
