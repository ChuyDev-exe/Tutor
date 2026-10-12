#!/usr/bin/env node
// Uso: node scripts/check-solutions.js [--capitulo <id>] [--omitir-faltantes] <carpeta-del-curso> [...]
// Extrae el primer bloque de código de cada «solucion» (.md) y comprueba que pasa las «pruebas» del ejercicio.
//   --capitulo <id>       solo prueba los ejercicios de ese capítulo
//   --omitir-faltantes    omite (sin fallar) los ejercicios cuya solución o pruebas aún no existen
// Sale con 1 si alguna solución falla. Pensado para autores y para IAs que generan cursos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runtimeFor, COMPILE_TIMEOUT_MS } = require('../out/runtimes');

const norm = (s) => s.replace(/\r\n/g, '\n').trim();
const args = process.argv.slice(2);
let capitulo;
let omitirFaltantes = false;
const dirs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--capitulo') capitulo = args[++i];
  else if (args[i] === '--omitir-faltantes') omitirFaltantes = true;
  else dirs.push(args[i]);
}
if (!dirs.length) {
  console.error('Uso: node scripts/check-solutions.js [--capitulo <id>] [--omitir-faltantes] <carpeta-del-curso> [...]');
  process.exit(2);
}

let failed = 0;
let checked = 0;
let skipped = 0;

for (const arg of dirs) {
  const dir = path.resolve(arg);
  const course = JSON.parse(fs.readFileSync(path.join(dir, 'curso.json'), 'utf8'));
  console.log(`\n== ${arg}${capitulo ? ` [capítulo ${capitulo}]` : ''} ==`);
  for (const ch of course.capitulos || []) {
    if (capitulo && ch.id !== capitulo) continue;
    for (const ex of ch.ejercicios || []) {
      const label = `${ch.id}/${ex.id} «${ex.titulo}»`;
      if (!ex.pruebas || !ex.solucion) {
        console.log(`  -  ${label}: sin pruebas o sin solución (omitido)`);
        skipped++;
        continue;
      }
      const rt = runtimeFor(ex.lenguaje);
      if (!rt) {
        console.log(`  -  ${label}: lenguaje sin runtime (omitido)`);
        skipped++;
        continue;
      }
      const solPath = path.join(dir, ex.solucion);
      const pruPath = path.join(dir, ex.pruebas);
      if (omitirFaltantes && (!fs.existsSync(solPath) || !fs.existsSync(pruPath))) {
        console.log(`  -  ${label}: archivos aún inexistentes (omitido)`);
        skipped++;
        continue;
      }
      const md = fs.readFileSync(solPath, 'utf8');
      const block = md.match(/```[\w+-]*\n([\s\S]*?)```/);
      checked++;
      if (!block) {
        console.log(`  ✖  ${label}: la solución no contiene un bloque de código`);
        failed++;
        continue;
      }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-'));
      const file = path.join(tmp, 'solucion' + rt.ext);
      fs.writeFileSync(file, block[1]);
      if (rt.compile) {
        const [cc, ...ccArgs] = rt.compile(file);
        const r = spawnSync(cc, ccArgs, { encoding: 'utf8', timeout: COMPILE_TIMEOUT_MS, cwd: tmp });
        if (r.status !== 0) {
          failed++;
          console.log(`  ✖  ${label}: no compila\n       ${(r.stderr || r.error?.message || '').trim().split('\n').join('\n       ')}`);
          continue;
        }
      }
      const cases = JSON.parse(fs.readFileSync(pruPath, 'utf8'));
      const problems = [];
      cases.forEach((c, i) => {
        const [cmd, ...cmdArgs] = rt.cmd(file);
        const r = spawnSync(cmd, cmdArgs, { input: c.entrada ?? '', encoding: 'utf8', timeout: rt.timeoutMs, cwd: tmp });
        const out = norm(r.stdout || '');
        const ok = r.status === 0 && (c.contiene !== undefined ? out.includes(norm(c.contiene)) : out === norm(c.esperado ?? ''));
        if (!ok) problems.push(`caso ${i + 1} «${c.nombre || ''}»: esperado «${c.contiene ?? c.esperado}», obtuvo «${out}»${r.stderr ? ' · ' + r.stderr.trim().split('\n').pop() : ''}`);
      });
      if (problems.length) {
        failed++;
        console.log(`  ✖  ${label}\n       ${problems.join('\n       ')}`);
      } else {
        console.log(`  ✔  ${label}: ${cases.length}/${cases.length} casos`);
      }
    }
  }
}
console.log(`\n${checked} ejercicio(s) comprobados, ${failed} con problemas, ${skipped} omitido(s).`);
process.exit(failed ? 1 : 0);
