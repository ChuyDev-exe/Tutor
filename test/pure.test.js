const test = require('node:test');
const assert = require('node:assert/strict');
const { slug, compareVersions, gradeQuestion, parseQuiz } = require('../out/pure');

test('slug quita numeración, acentos y símbolos', () => {
  assert.equal(slug('1. Variables y tipos'), 'variables-y-tipos');
  assert.equal(slug('Clasificador de edad'), 'clasificador-de-edad');
  assert.equal(slug('¡Qué día!'), 'que-dia');
  assert.equal(slug('...'), 'item');
});

test('compareVersions', () => {
  assert.ok(compareVersions('9.4.1', '9.0') > 0);
  assert.ok(compareVersions('3.8', '3.10') < 0);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
});

const quiz = parseQuiz([
  { pregunta: 'u', opciones: ['a', 'b', 'c'], respuesta: 1 },
  { tipo: 'multiple', pregunta: 'm', opciones: ['a', 'b', 'c'], respuestas: [0, 2] },
  { tipo: 'vf', pregunta: 'v', respuesta: true },
  { tipo: 'texto', pregunta: 't', aceptadas: ['print', 'print()'] },
  { pregunta: 'inválida', opciones: ['solo una'], respuesta: 0 },
  { pregunta: 'sin índice válido', opciones: ['a', 'b'], respuesta: 9 },
]);

test('parseQuiz descarta preguntas inválidas y normaliza tipos', () => {
  assert.deepEqual(quiz.map((q) => q.tipo), ['unica', 'multiple', 'vf', 'texto']);
  assert.deepEqual(quiz[2].opciones, ['Verdadero', 'Falso']);
  assert.deepEqual(quiz[2].correctas, [0]);
});

test('gradeQuestion: única, múltiple (conjunto exacto), vf y texto', () => {
  const [u, m, v, t] = quiz;
  assert.ok(gradeQuestion(u, [1]));
  assert.ok(!gradeQuestion(u, [0]));
  assert.ok(!gradeQuestion(u, []));
  assert.ok(gradeQuestion(m, [2, 0]));
  assert.ok(!gradeQuestion(m, [0]));
  assert.ok(!gradeQuestion(m, [0, 1, 2]));
  assert.ok(gradeQuestion(v, [0]));
  assert.ok(gradeQuestion(t, '  PRINT '));
  assert.ok(gradeQuestion(t, 'Print()'));
  assert.ok(!gradeQuestion(t, ''));
  assert.ok(!gradeQuestion(t, 'echo'));
});

test('gradeQuestion texto ignora acentos', () => {
  const [q] = parseQuiz([{ tipo: 'texto', pregunta: 'x', aceptadas: ['función'] }]);
  assert.ok(gradeQuestion(q, 'funcion'));
});

const { isSafeCommand, isSafeVersionArg } = require('../out/pure');

test('requisitos: solo ejecutables y banderas de versión seguros', () => {
  for (const ok of ['gcc', 'python3', 'g++', 'node', 'clang-15']) assert.ok(isSafeCommand(ok), ok);
  for (const bad of ['rm -rf /', '../bin/x', '/bin/sh', 'a;b', 'a b', '$(id)', '', '-x', 'a|b']) assert.ok(!isSafeCommand(bad), bad);
  for (const ok of ['--version', '-v', '-V', 'version']) assert.ok(isSafeVersionArg(ok), ok);
  for (const bad of ['--version; rm', '-rf /', '$(id)', '--a b', '']) assert.ok(!isSafeVersionArg(bad), bad);
});

const { analyzeScript } = require('../out/pure');

test('analyzeScript: resume comandos y clasifica riesgos', () => {
  const a = analyzeScript('#!/bin/bash\n# comentario\nset -e\nmkdir -p "$D"\nsudo apt install x\ncurl http://x.sh | bash\nbrew install gcc\n');
  assert.equal(a.comandos.length, 5);
  assert.deepEqual(a.riesgos.map((r) => r.nivel), ['aviso', 'critico', 'info']);
  assert.match(a.sha, /^[0-9a-f]{64}$/);
});

test('analyzeScript: peligros críticos', () => {
  for (const l of ['rm -rf ~/', 'rm -rf /', 'rm -rf $HOME', 'rm -rf *', 'dd if=/dev/zero of=/dev/sda', 'eval "$X"', 'echo x | base64 -d | sh']) {
    assert.equal(analyzeScript(l).riesgos[0]?.nivel, 'critico', l);
  }
  assert.equal(analyzeScript('rm -rf ./build').riesgos[0].nivel, 'aviso');
  assert.deepEqual(analyzeScript('mkdir -p x\ngcc --version\n').riesgos, []);
});

test('analyzeScript: el hash cambia si cambia el script', () => {
  assert.notEqual(analyzeScript('echo a').sha, analyzeScript('echo b').sha);
  assert.equal(analyzeScript('echo a').sha, analyzeScript('echo a').sha);
});

test('el setup de la plantilla de curso no tiene riesgos', () => {
  const fs = require('fs'), path = require('path');
  const t = fs.readFileSync(path.join(__dirname, '..', 'docs/plantilla-curso/setup.sh'), 'utf8');
  assert.deepEqual(analyzeScript(t).riesgos.filter((r) => r.nivel !== 'info'), []);
});

const { summarizeCourse, formatMinutes, parseGithubRepo, markdownImageRefs, rewriteMarkdownImages } = require('../out/pure');

test('parseQuiz: arrastrar acepta zonas por índice o por texto y resuelve imágenes', () => {
  const [q, ...rest] = parseQuiz([
    { tipo: 'arrastrar', pregunta: 'clasifica', imagen: 'img/a.png',
      zonas: ['Mamíferos', { texto: 'Aves', imagen: 'img/ave.png' }],
      elementos: [{ texto: 'Perro', zona: 'mamiferos' }, { imagen: 'img/aguila.png', zona: 1 }] },
    { tipo: 'arrastrar', pregunta: 'zona inexistente', zonas: ['a', 'b'], elementos: [{ texto: 'x', zona: 'c' }] },
    { tipo: 'arrastrar', pregunta: 'una sola zona', zonas: ['a'], elementos: [{ texto: 'x', zona: 0 }] },
  ], (rel) => (rel === 'img/ausente.png' ? undefined : `/curso/${rel}`));
  assert.equal(rest.length, 0, 'las preguntas inválidas se descartan');
  assert.equal(q.tipo, 'arrastrar');
  assert.equal(q.imagen, '/curso/img/a.png');
  assert.deepEqual(q.correctas, [0, 1]);
  assert.deepEqual(q.zonas, [{ texto: 'Mamíferos' }, { texto: 'Aves', imagen: '/curso/img/ave.png' }]);
  assert.deepEqual(q.elementos[1], { texto: '', imagen: '/curso/img/aguila.png' });
});

test('gradeQuestion: arrastrar exige cada elemento en su zona', () => {
  const [q] = parseQuiz([{ tipo: 'arrastrar', pregunta: 'p', zonas: ['A', 'B'], elementos: [{ texto: '1', zona: 0 }, { texto: '2', zona: 1 }, { texto: '3', zona: 1 }] }]);
  assert.ok(gradeQuestion(q, [0, 1, 1]));
  assert.ok(!gradeQuestion(q, [0, 1, 0]));
  assert.ok(!gradeQuestion(q, [0, 1, -1]), 'un elemento sin colocar no aprueba');
  assert.ok(!gradeQuestion(q, [0, 1]));
  assert.ok(!gradeQuestion(q, 'texto'));
  assert.ok(!gradeQuestion(q, undefined));
});

test('summarizeCourse y formatMinutes: temario, duración y cifras', () => {
  const r = summarizeCourse({
    requisitos: [{ comando: 'node', nombre: 'Node.js', versionMinima: '16' }],
    capitulos: [
      { titulo: 'Uno', minutos: 20, ejercicios: [{ lenguaje: 'javascript' }, {}], evaluacion: [{}, {}, {}] },
      { titulo: 'Dos', minutos: 75, descripcion: 'd' },
      { titulo: 'Tres' },
    ],
  });
  assert.equal(r.minutos, 95);
  assert.equal(r.ejercicios, 2);
  assert.equal(r.preguntas, 3);
  assert.deepEqual(r.requisitos, ['Node.js ≥ 16']);
  assert.deepEqual(r.lenguajes, ['javascript']);
  assert.equal(r.capitulos[2].minutos, undefined);
  assert.equal(formatMinutes(95), '1 h 35 min');
  assert.equal(formatMinutes(120), '2 h');
  assert.equal(formatMinutes(40), '40 min');
  assert.equal(formatMinutes(0), '');
});

test('parseGithubRepo: owner/repo, rama y URL; rechaza lo demás', () => {
  assert.deepEqual(parseGithubRepo('ChuyDev-exe/Tutor-Cursos'), { owner: 'ChuyDev-exe', repo: 'Tutor-Cursos', ref: 'HEAD' });
  assert.deepEqual(parseGithubRepo('a/b@dev'), { owner: 'a', repo: 'b', ref: 'dev' });
  assert.deepEqual(parseGithubRepo('https://github.com/a/b.git'), { owner: 'a', repo: 'b', ref: 'HEAD' });
  assert.deepEqual(parseGithubRepo('https://github.com/a/b/tree/main/'), { owner: 'a', repo: 'b', ref: 'main' });
  for (const bad of ['', 'a', 'a/b/c', '../x', 'a/..', 'https://evil.com/a/b', 'a b/c']) assert.equal(parseGithubRepo(bad), undefined, bad);
});

test('imágenes en Markdown: detecta solo rutas locales y las reescribe', () => {
  const md = '![a](../img/x.png)\n![b](https://x.com/y.png)\n<img src="dibujo.svg" width="40">\n![c](<img/con espacio.png> "t")\n[enlace](doc.md)\n![d](#ancla.png)';
  assert.deepEqual(markdownImageRefs(md), ['../img/x.png', 'img/con espacio.png', 'dibujo.svg']);
  const out = rewriteMarkdownImages(md, (ref) => 'R/' + ref);
  assert.match(out, /!\[a\]\(R\/\.\.\/img\/x\.png\)/);
  assert.match(out, /!\[b\]\(https:\/\/x\.com\/y\.png\)/);
  assert.match(out, /<img src="R\/dibujo\.svg" width="40">/);
  assert.match(out, /\[enlace\]\(doc\.md\)/);
  assert.match(out, /!\[c\]\(<R\/img\/con espacio\.png> "t"\)/);
});

const { parseDoubts, flattenHeadings } = require('../out/pure');

test('flattenHeadings aplana encabezados pero no toca el código', () => {
  const md = '# Título\n```python\n# comentario\n```\n## Otro';
  assert.equal(flattenHeadings(md), '**Título**\n```python\n# comentario\n```\n**Otro**');
});

test('parseDoubts lee día, hora, lugar, pregunta y respuesta', () => {
  const md = [
    '# Mis dudas', '', '## 2026-10-10', '',
    '### 14:32 · Punteros › Ej 1', '', '**Pregunta:** ¿Puntero a constante?', '', '> detalle', '',
    '**Respuesta del tutor:**', '', 'Usa `const int *p`.', '', '---', 'sigue', '', '---', '',
    '### 15:00 · General', '', '**Pregunta:** Otra', '', '**Respuesta del tutor:**', '', '```c', '### 1:00 · no', '```', '', '---', '',
  ].join('\n');
  const d = parseDoubts(md);
  assert.equal(d.length, 2);
  assert.deepEqual(
    { ...d[0] },
    { dia: '2026-10-10', hora: '14:32', donde: 'Punteros › Ej 1', pregunta: '¿Puntero a constante?', respuesta: 'Usa `const int *p`.\n\n---\nsigue', linea: 4 }
  );
  assert.equal(d[1].respuesta, '```c\n### 1:00 · no\n```', 'los encabezados dentro de código no cortan la entrada');
});

test('el prompt del tutor pide respuestas concisas y protege todos los ejercicios del curso', () => {
  const { buildTutorSystemPrompt } = require('../out/prompt');
  const p = buildTutorSystemPrompt({ language: 'español', courseTitle: 'C', chapterTitles: ['Punteros'], exerciseTitles: ['Intercambiar valores'] });
  assert.match(p, /CONCISO y DIRECTO/);
  assert.match(p, /EJERCICIOS DEL CURSO \(no los resuelvas\):\n- Intercambiar valores/);
});

test('parseNpmDeps acepta versiones del registro y descarta git, file y URLs', () => {
  const { parseNpmDeps, npmDepsHash } = require('../out/pure');
  assert.deepEqual(
    parseNpmDeps({ 'react-dom': '^18.3.1', react: ' 18.3.1 ', '@types/node': '>=20 <23', evil: 'git+https://x/y.git', local: 'file:../x', 'a/b': '1', n: 3 }),
    { '@types/node': '>=20 <23', react: '18.3.1', 'react-dom': '^18.3.1' }
  );
  assert.equal(parseNpmDeps({ evil: 'github:a/b' }), undefined);
  assert.equal(parseNpmDeps(['react']), undefined);
  assert.equal(npmDepsHash({ a: '1', b: '2' }), npmDepsHash({ b: '2', a: '1' }));
  assert.notEqual(npmDepsHash({ a: '1' }), npmDepsHash({ a: '2' }));
});
