#!/usr/bin/env node
// Uso: node scripts/check-solutions.js <carpeta-del-curso> [...]
// Extrae el primer bloque de código de cada «solucion» (.md) y comprueba que pasa las «pruebas» del ejercicio.
// Sale con 1 si alguna solución falla. Pensado para autores y para IAs que generan cursos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runtimeFor } = require('../out/runtimes');

const norm = (s) => s.replace(/\r\n/g, '\n').trim();
let failed = 0;
let checked = 0;

for (const arg of process.argv.slice(2)) {
  const dir = path.resolve(arg);
  const course = JSON.parse(fs.readFileSync(path.join(dir, 'curso.json'), 'utf8'));
  console.log(`\n== ${arg} ==`);
  for (const ch of course.capitulos || []) {
    for (const ex of ch.ejercicios || []) {
      const label = `${ch.id}/${ex.id} «${ex.titulo}»`;
      if (!ex.pruebas || !ex.solucion) {
        console.log(`  -  ${label}: sin pruebas o sin solución (omitido)`);
        continue;
      }
      const rt = runtimeFor(ex.lenguaje);
      if (!rt) {
        console.log(`  -  ${label}: lenguaje sin runtime (omitido)`);
        continue;
      }
      const md = fs.readFileSync(path.join(dir, ex.solucion), 'utf8');
      const block = md.match(/```[\w+-]*\n([\s\S]*?)```/);
      if (!block) {
        console.log(`  ✖  ${label}: la solución no contiene un bloque de código`);
        failed++;
        continue;
      }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-'));
      const file = path.join(tmp, 'solucion' + rt.ext);
      fs.writeFileSync(file, block[1]);
      const cases = JSON.parse(fs.readFileSync(path.join(dir, ex.pruebas), 'utf8'));
      const problems = [];
      cases.forEach((c, i) => {
        const [cmd, ...args] = rt.cmd(file);
        const r = spawnSync(cmd, args, { input: c.entrada ?? '', encoding: 'utf8', timeout: rt.timeoutMs, cwd: tmp });
        const out = norm(r.stdout || '');
        const ok = r.status === 0 && (c.contiene !== undefined ? out.includes(norm(c.contiene)) : out === norm(c.esperado ?? ''));
        if (!ok) problems.push(`caso ${i + 1} «${c.nombre || ''}»: esperado «${c.contiene ?? c.esperado}», obtuvo «${out}»${r.stderr ? ' · ' + r.stderr.trim().split('\n').pop() : ''}`);
      });
      checked++;
      if (problems.length) {
        failed++;
        console.log(`  ✖  ${label}\n       ${problems.join('\n       ')}`);
      } else {
        console.log(`  ✔  ${label}: ${cases.length}/${cases.length} casos`);
      }
    }
  }
}
console.log(`\n${checked} ejercicio(s) comprobados, ${failed} con problemas.`);
process.exit(failed ? 1 : 0);
