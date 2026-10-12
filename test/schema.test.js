const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Ajv = require('ajv');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const curso = ajv.compile(read('schemas/curso.schema.json'));
const catalogo = ajv.compile(read('schemas/catalogo.schema.json'));
// cursos de ejemplo opcionales (examples/repo) más la plantilla, que siempre está en el repositorio
const examples = path.join(root, 'examples/repo/cursos');
const courses = [
  ...(fs.existsSync(examples) ? fs.readdirSync(examples).map((n) => `examples/repo/cursos/${n}`) : []),
  'docs/plantilla-curso',
];

for (const dir of courses) {
  test(`${dir}/curso.json cumple el esquema`, () => {
    const ok = curso(read(`${dir}/curso.json`));
    assert.ok(ok, JSON.stringify(curso.errors, null, 1));
  });
}

test('el catálogo de ejemplo cumple el esquema', { skip: !fs.existsSync(path.join(root, 'examples/repo/catalogo.json')) && 'sin examples/repo' }, () => {
  assert.ok(catalogo(read('examples/repo/catalogo.json')), JSON.stringify(catalogo.errors));
});

test('el esquema rechaza los errores típicos de una IA', () => {
  const base = () => JSON.parse(JSON.stringify(read('docs/plantilla-curso/curso.json')));
  const mutate = (fn) => { const c = base(); fn(c); return curso(c); };
  assert.equal(mutate((c) => { c.id = 'Mi Curso'; }), false, 'id con mayúsculas y espacios');
  assert.equal(mutate((c) => { delete c.capitulos[0].archivo; }), false, 'capítulo sin manual');
  assert.equal(mutate((c) => { c.capitulos[0].campoInventado = 1; }), false, 'campo inventado');
  assert.equal(mutate((c) => { c.requisitos[0].comando = 'rm -rf /'; }), false, 'comando peligroso');
  assert.equal(mutate((c) => { delete c.capitulos[0].ejercicios[0].lenguaje; }), false, 'pruebas sin lenguaje');
  assert.equal(mutate((c) => { c.capitulos[0].ejercicios[0].lenguaje = 'cobol'; }), false, 'lenguaje no soportado');
  assert.equal(mutate((c) => { c.capitulos[0].evaluacion[0].respuesta = 'b'; }), false, 'respuesta no numérica');
  assert.equal(mutate((c) => { c.capitulos[0].evaluacion[2].respuesta = 'si'; }), false, 'vf no booleano');
  assert.equal(mutate((c) => { delete c.capitulos[0].evaluacion[3].aceptadas; }), false, 'texto sin aceptadas');
  assert.equal(mutate((c) => { c.capitulos[0].evaluacion[1].respuestas = []; }), false, 'multiple sin respuestas');
  assert.equal(mutate((c) => { c.version = 'uno'; }), false, 'versión no numérica');
});

test('las soluciones de los cursos pasan sus propias pruebas', (t) => {
  const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
  if (!have('python3')) return t.skip('python3 no está instalado');
  const dirs = ['docs/plantilla-curso'];
  if (fs.existsSync(path.join(examples, 'python-basico'))) dirs.push('examples/repo/cursos/python-basico');
  if (have('gcc') && fs.existsSync(path.join(examples, 'c-basico'))) dirs.push('examples/repo/cursos/c-basico');
  const r = spawnSync('node', ['scripts/check-solutions.js', ...dirs], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
