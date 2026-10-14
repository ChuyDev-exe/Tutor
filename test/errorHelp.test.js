const test = require('node:test');
const assert = require('node:assert/strict');
const { parseErrorLocations, reviewAfterAnswer, addDays, isDue, REVIEW_DAYS } = require('../out/pure');

const at = (out, file) => parseErrorLocations(out, file).map((e) => [e.line, e.col, e.severity, e.message]);

test('gcc: errores y avisos del archivo del alumno; ignora notas y otros archivos', () => {
  const out = [
    "/ws/c/01/edad.c: In function 'main':",
    "/ws/c/01/edad.c:5:5: error: 'x' undeclared (first use in this function)",
    '    5 |     x = 3;',
    '      |     ^',
    "/ws/c/01/edad.c:5:5: note: each undeclared identifier is reported only once",
    "/ws/c/01/edad.c:7:10: warning: unused variable 'y' [-Wunused-variable]",
    '/usr/include/stdio.h:12:1: error: algo del sistema',
  ].join('\n');
  assert.deepEqual(at(out, '/ws/c/01/edad.c'), [
    [5, 5, 'error', "'x' undeclared (first use in this function)"],
    [7, 10, 'warning', "unused variable 'y' [-Wunused-variable]"],
  ]);
});

test('compara por nombre de archivo (rutas de Docker y de Windows)', () => {
  assert.deepEqual(at('/work/edad.c:3:1: error: expected ; before }', 'C:\\Users\\ana\\c\\edad.c'), [[3, 1, 'error', 'expected ; before }']]);
  assert.deepEqual(at('C:\\Users\\ana\\c\\edad.c:4:2: error: boom', '/otra/ruta/edad.c'), [[4, 2, 'error', 'boom']]);
});

test('go build', () => {
  assert.deepEqual(at('# command-line-arguments\n./main.go:6:2: declared and not used: x', '/ws/go/main.go'), [[6, 2, 'error', 'declared and not used: x']]);
});

test('go: panic en tiempo de ejecución', () => {
  const out = 'panic: runtime error: index out of range [3] with length 3\n\ngoroutine 1 [running]:\nmain.main()\n\t/work/main.go:9 +0x1d\nexit status 2';
  assert.deepEqual(at(out, '/ws/main.go'), [[9, undefined, 'error', 'panic: runtime error: index out of range [3] with length 3']]);
});

test('python: último marco del alumno + excepción final', () => {
  const out = [
    'Traceback (most recent call last):',
    '  File "/ws/py/01/suma.py", line 8, in <module>',
    '    main()',
    '  File "/ws/py/01/suma.py", line 5, in main',
    '    print(total + nombre)',
    '  File "/usr/lib/python3.12/otro.py", line 99, in f',
    "TypeError: unsupported operand type(s) for +: 'int' and 'str'",
  ].join('\n');
  assert.deepEqual(at(out, '/ws/py/01/suma.py'), [[5, undefined, 'error', "TypeError: unsupported operand type(s) for +: 'int' and 'str'"]]);
});

test('python: SyntaxError', () => {
  const out = '  File "/ws/suma.py", line 2\n    if x = 3:\n         ^\nSyntaxError: invalid syntax';
  assert.deepEqual(at(out, '/ws/suma.py'), [[2, undefined, 'error', 'SyntaxError: invalid syntax']]);
});

test('node: excepción con pila', () => {
  const out = [
    '/ws/js/app.js:3',
    'console.log(nombre);',
    '            ^',
    '',
    'ReferenceError: nombre is not defined',
    '    at Object.<anonymous> (/ws/js/app.js:3:13)',
    '    at Module._compile (node:internal/modules/cjs/loader:1256:14)',
  ].join('\n');
  assert.deepEqual(at(out, '/ws/js/app.js'), [[3, 13, 'error', 'ReferenceError: nombre is not defined']]);
});

test('node: error de sintaxis (sin marco del alumno)', () => {
  const out = '/ws/js/app.js:2\nlet = 5;\n    ^\n\nSyntaxError: Unexpected token \'=\'\n    at internalCompileFunction (node:internal/vm:76:18)';
  assert.deepEqual(at(out, '/ws/js/app.js'), [[2, undefined, 'error', "SyntaxError: Unexpected token '='"]]);
});

test('tsx (esbuild): el mensaje va en la línea anterior a la ubicación', () => {
  const out = '✘ [ERROR] Expected ";" but found "y"\n\n    /ws/ts/app.ts:4:6:\n      4 │ let x y = 3;\n        ╵       ^';
  assert.deepEqual(at(out, '/ws/ts/app.ts'), [[4, 6, 'error', 'Expected ";" but found "y"']]);
});

test('bash', () => {
  assert.deepEqual(at('/ws/sh/hola.sh: line 3: ech: command not found', '/ws/sh/hola.sh'), [[3, undefined, 'error', 'ech: command not found']]);
});

test('sin ubicación (salida distinta a la esperada) → nada; los códigos de color ANSI no estorban', () => {
  assert.deepEqual(at('Pruebas: 1/2. Fallan:\n- Caso 2: esperado «5», obtuvo «4»', '/ws/a.py'), []);
  assert.deepEqual(at('\x1b[1m/ws/a.c:2:3: \x1b[31merror: \x1b[0mboom', '/ws/a.c'), [[2, 3, 'error', 'boom']]);
});

test('repaso: fallar crea la tarjeta para mañana; acertar en su día la sube de caja', () => {
  const d = '2026-10-13';
  assert.equal(addDays(d, 1), '2026-10-14');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(reviewAfterAnswer(undefined, true, d), undefined, 'acertar sin haber fallado no crea tarjeta');
  let card = reviewAfterAnswer(undefined, false, d);
  assert.deepEqual(card, { caja: 0, proxima: '2026-10-14' });
  assert.ok(!isDue(card, d) && isDue(card, '2026-10-14'));
  assert.equal(reviewAfterAnswer(card, true, d), card, 'acertar antes de tiempo no la adelanta');
  card = reviewAfterAnswer(card, true, '2026-10-14');
  assert.deepEqual(card, { caja: 1, proxima: addDays('2026-10-14', REVIEW_DAYS[1]) });
  assert.deepEqual(reviewAfterAnswer(card, false, '2026-10-20'), { caja: 0, proxima: '2026-10-21' }, 'fallar la devuelve a la caja 0');
});

test('repaso: acertar en la última caja la da por aprendida', () => {
  const last = { caja: REVIEW_DAYS.length - 1, proxima: '2026-10-13' };
  assert.equal(reviewAfterAnswer(last, true, '2026-10-13'), undefined);
});
