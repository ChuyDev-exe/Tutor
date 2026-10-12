const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
require('./vscode-stub').install();
const { runJsonTests, runSolution } = require('../out/runner');
const { editLine, toTerminal } = require('../out/terminalRun');
const { readSSE } = require('../out/aiClient');

const hasGcc = spawnSync('gcc', ['--version']).status === 0;

test('editLine: eco, borrado, líneas completas, Ctrl+C y Ctrl+D', () => {
  let r = editLine('', 'hola');
  assert.deepEqual([r.echo, r.lines, r.buffer], ['hola', [], 'hola']);
  r = editLine(r.buffer, '\x7f\x7f');
  assert.deepEqual([r.echo, r.buffer], ['\b \b\b \b', 'ho']);
  r = editLine(r.buffer, 'la\rmundo\r');
  assert.deepEqual([r.lines, r.buffer], [['hola', 'mundo'], '']);
  assert.equal(editLine('', '\x1b[A\x1b[D').echo, '', 'las flechas se ignoran');
  assert.equal(editLine('', '\x7f').echo, '', 'borrar sin texto no pinta nada');
  assert.equal(editLine('', 'ñ').buffer, 'ñ');
  assert.ok(editLine('x', '\x03').interrupt);
  assert.ok(editLine('x', '\x04').eof);
});

test('toTerminal convierte saltos de línea', () => {
  assert.equal(toTerminal('a\nb\r\nc'), 'a\r\nb\r\nc');
});

test('readSSE junta eventos partidos entre fragmentos e ignora [DONE]', async () => {
  const enc = new TextEncoder();
  const chunks = ['data: {"a":1}\n\nda', 'ta: {"a":2}\n', ': comentario\ndata: [DONE]\n', 'data: {"a":3}'];
  const body = new ReadableStream({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
  let ticks = 0;
  const got = [];
  for await (const d of readSSE(body, () => ticks++)) got.push(d.a);
  assert.deepEqual(got, [1, 2, 3]);
  assert.equal(ticks, chunks.length);
});

test('C: compila una sola vez y corre todos los casos', { skip: !hasGcc && 'sin gcc' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutor-c-'));
  const file = path.join(dir, 'doble.c');
  fs.writeFileSync(file, '#include <stdio.h>\nint main(void){int n; scanf("%d",&n); printf("%d\\n", n*2); return 0;}\n');
  const report = await runJsonTests(file, 'c', [
    { entrada: '2', esperado: '4' },
    { entrada: '21', esperado: '42' },
  ]);
  assert.equal(report.passed, 2);
  assert.ok(fs.existsSync(path.join(dir, process.platform === 'win32' ? 'doble.exe' : 'doble.out')));
});

test('C: un error de compilación se reporta como un caso, sin correr nada', { skip: !hasGcc && 'sin gcc' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutor-c-'));
  const file = path.join(dir, 'roto.c');
  fs.writeFileSync(file, 'int main(void){ return x; }\n');
  const report = await runJsonTests(file, 'c', [{ entrada: '', esperado: '' }]);
  assert.equal(report.passed, 0);
  assert.equal(report.cases[0].nombre, 'Compilación');
  assert.match(report.cases[0].stderr, /x/);
  const run = await runSolution(file, 'c');
  assert.equal(run.ok, false);
  assert.equal(run.error, 'Error de compilación');
});

const { buildCommand, toolFor, RUNTIMES, dockerMode } = require('../out/runtimes');
const dockerOk = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 15000 }).status === 0;

test('buildCommand: en local no cambia nada; en Docker monta la carpeta y usa rutas del contenedor', () => {
  const file = path.join(os.tmpdir(), 'curso', 'doble.py');
  assert.deepEqual(buildCommand(RUNTIMES.python.cmd, file).argv, RUNTIMES.python.cmd(file));
  const { argv, stop } = buildCommand(RUNTIMES.python.cmd, file, dockerMode(RUNTIMES.python));
  assert.equal(argv[0], 'docker');
  assert.ok(argv.includes(`type=bind,source=${path.dirname(file)},target=/work`));
  assert.ok(argv.includes('--network') && argv.includes('none'), 'sin red por defecto');
  assert.deepEqual(argv.slice(-2), [process.platform === 'win32' ? 'python' : 'python3', '/work/doble.py'].slice(-2));
  assert.equal(typeof stop, 'function');
  assert.ok(!buildCommand(RUNTIMES.typescript.cmd, file, dockerMode(RUNTIMES.typescript)).argv.includes('none'), 'npx necesita red');
});

test('toolFor: el compilador para C/C++, el intérprete para el resto', () => {
  assert.equal(toolFor(RUNTIMES.c), 'gcc');
  assert.equal(toolFor(RUNTIMES.cpp), 'g++');
  assert.equal(toolFor(RUNTIMES.go), 'go');
  assert.equal(toolFor(RUNTIMES.javascript), 'node');
});

test('Docker: corre pruebas de C dentro de un contenedor', { skip: !dockerOk && 'Docker no disponible', timeout: 300_000 }, async () => {
  spawnSync('docker', ['pull', RUNTIMES.c.imagen], { stdio: 'ignore' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutor-docker-'));
  const file = path.join(dir, 'doble.c');
  fs.writeFileSync(file, '#include <stdio.h>\nint main(void){int n; scanf("%d",&n); printf("%d\\n", n*2); return 0;}\n');
  const report = await runJsonTests(file, 'c', [{ entrada: '5', esperado: '10' }], dockerMode(RUNTIMES.c));
  assert.equal(report.passed, 1, JSON.stringify(report.cases));
});
