const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { install } = require('./vscode-stub');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
const examples = path.join(__dirname, '..', 'examples', 'repo', 'cursos');
install({ workspace: ws, config: { contentPath: examples } });

const { tutorState } = require('../out/state');
const { loadCourses } = require('../out/content');
const folder = require('../out/studentFolder');
const doubts = require('../out/doubts');

tutorState.init({ globalStorageUri: { fsPath: path.join(ws, '_global') } });
const course = loadCourses({}).find((c) => c.id === 'c-basico');

test('el curso de ejemplo se carga con requisitos, setup y pistas graduales', () => {
  assert.ok(course);
  assert.equal(course.requisitos.length, 2);
  assert.ok(course.setupFile.endsWith('setup.sh'));
  assert.equal(course.capitulos[0].ejercicios[0].pistaFiles.length, 3);
});

test('la carpeta del alumno solo contiene capítulos desbloqueados', () => {
  const root = folder.syncStudentFolder(course, (i) => i === 0);
  const entries = fs.readdirSync(root).sort();
  assert.ok(entries.includes('MANUAL.md'));
  assert.ok(entries.some((e) => e.startsWith('01-')));
  assert.ok(!entries.some((e) => e.startsWith('02-')), 'el capítulo 2 no debe existir en disco');
  const ch1 = fs.readdirSync(path.join(root, entries.find((e) => e.startsWith('01-'))));
  assert.ok(ch1.includes('manual.md'));
  assert.ok(ch1.includes('suma-de-dos-numeros.c'));
  assert.ok(ch1.includes('suma-de-dos-numeros.md'), 'enunciado junto al archivo');
  assert.ok(!ch1.some((f) => f.includes('solucion')), 'la solución nunca va a la carpeta del alumno');
});

test('el trabajo del alumno nunca se sobrescribe, y resetear deja copia .bak', () => {
  const ch = course.capitulos[0];
  const ex = ch.ejercicios[0];
  const file = folder.ensureExerciseFile(course, ch, ex);
  fs.writeFileSync(file, 'MI CÓDIGO');
  folder.syncStudentFolder(course, () => true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'MI CÓDIGO');
  folder.resetExerciseFile(course, ch, ex);
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), 'MI CÓDIGO');
  assert.match(fs.readFileSync(file, 'utf8'), /TODO/);
});

test('las pistas se revelan de forma acumulativa', () => {
  const ch = course.capitulos[0];
  const ex = ch.ejercicios[0];
  const one = fs.readFileSync(folder.writeHints(course, ch, ex, 1), 'utf8');
  assert.match(one, /Pista 1 de 3/);
  assert.doesNotMatch(one, /Pista 2 de 3/);
  const two = fs.readFileSync(folder.writeHints(course, ch, ex, 2), 'utf8');
  assert.match(two, /Pista 2 de 3/);
});

test('dudas: guarda pregunta y respuesta, agrupa por día y aplana encabezados', () => {
  const ch = course.capitulos[0];
  const d1 = new Date(2026, 9, 10, 14, 32);
  const file = doubts.saveDoubt(course, ch, ch.ejercicios[0], '¿Qué diferencia hay con C++?\nSegunda línea', '# Título\nEn C++ hay clases.', d1);
  doubts.saveDoubt(course, ch, undefined, 'Otra duda', 'Respuesta 2', new Date(2026, 9, 10, 15, 0));
  doubts.saveDoubt(course, undefined, undefined, 'Duda de otro día', 'Respuesta 3', new Date(2026, 9, 11, 9, 5));
  const md = fs.readFileSync(file, 'utf8');
  assert.equal(path.basename(file), 'dudas-y-preguntas.md');
  assert.ok(file.startsWith(folder.studentRoot(course)));
  assert.match(md, /^# Mis dudas y preguntas — C desde cero/);
  assert.equal((md.match(/^## 2026-10-10$/gm) || []).length, 1, 'un solo encabezado por día');
  assert.match(md, /^## 2026-10-11$/m);
  assert.match(md, /### 14:32 · 1\. Hola, C › Suma de dos números/);
  assert.match(md, /^> Segunda línea$/m);
  assert.match(md, /^\*\*Título\*\*$/m, 'los # de la respuesta se aplanan');
  assert.deepEqual(doubts.recentQuestions(course, 2), ['Otra duda', 'Duda de otro día']);
});

test('dudas sin curso van a la raíz del workspace', () => {
  const file = doubts.saveDoubt(undefined, undefined, undefined, 'Duda suelta', 'ok');
  assert.equal(file, path.join(ws, 'dudas-y-preguntas.md'));
});

test('.tutor es un archivo JSON con puntero al store', () => {
  tutorState.registerCourse('c-basico', 'prueba');
  const f = path.join(ws, '.tutor');
  assert.ok(fs.statSync(f).isFile());
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(data.version, 2);
  assert.ok(data.store.startsWith(path.join(ws, '_global')));
  assert.ok(data.cursos['c-basico']);
});

test('ids de curso maliciosos no pueden escapar de la carpeta del workspace', () => {
  for (const id of ['..', '../../etc', '.', '/abs/path', 'a/../b']) {
    const root = folder.studentRoot({ id });
    assert.equal(path.dirname(root), ws, `id ${id} → ${root}`);
    assert.ok(!path.basename(root).includes('.'));
  }
});

const thoughts = require('../out/thoughts');

test('pensamientos: se anotan como lista de tareas, agrupados por día', () => {
  const file = thoughts.parkThought(course, 'Responder a María\nmañana', new Date(2026, 9, 10, 9, 5));
  thoughts.parkThought(course, 'Mirar precios', new Date(2026, 9, 10, 9, 40));
  thoughts.parkThought(course, 'Otro día', new Date(2026, 9, 11, 8, 0));
  const md = fs.readFileSync(file, 'utf8');
  assert.equal(path.basename(file), 'pensamientos-pendientes.md');
  assert.ok(file.startsWith(folder.studentRoot(course)));
  assert.equal((md.match(/^## 2026-10-10$/gm) || []).length, 1);
  assert.match(md, /^- \[ \] 09:05 — Responder a María mañana$/m, 'una sola línea');
  assert.match(md, /^## 2026-10-11$/m);
});

test('estadísticas de enfoque: se acumulan por día y el reinicio total las borra', () => {
  const before = tutorState.focusToday();
  tutorState.addFocus({ minutos: 25, sesiones: 1 });
  tutorState.addFocus({ ejercicios: 2 });
  const d = tutorState.focusToday();
  assert.equal(d.minutos, before.minutos + 25);
  assert.equal(d.sesiones, before.sesiones + 1);
  assert.equal(d.ejercicios, before.ejercicios + 2);
  assert.ok(JSON.parse(fs.readFileSync(path.join(ws, '.tutor'), 'utf8')).enfoque);
  tutorState.resetProgress();
  assert.deepEqual(tutorState.focusToday(), { minutos: 0, sesiones: 0, ejercicios: 0 });
});
