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

test('el setup del curso de ejemplo no tiene riesgos', () => {
  const fs = require('fs'), path = require('path');
  for (const n of ['c-basico', 'python-basico', 'demo-requisitos']) {
    const t = fs.readFileSync(path.join(__dirname, '..', 'examples/repo/cursos', n, 'setup.sh'), 'utf8');
    assert.deepEqual(analyzeScript(t).riesgos.filter((r) => r.nivel !== 'info'), [], n);
  }
});
