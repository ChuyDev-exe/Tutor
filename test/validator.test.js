const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateCourseDir } = require('../out/validator');

test('la plantilla de curso es válida', () => {
  const errors = validateCourseDir(path.join(__dirname, '..', 'docs', 'plantilla-curso')).filter((i) => i.nivel === 'error');
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test('detecta archivos ausentes, ids repetidos y preguntas mal formadas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curso-'));
  fs.writeFileSync(path.join(dir, 'curso.json'), JSON.stringify({
    id: 'x', titulo: 'X',
    capitulos: [
      { id: 'c1', titulo: 'Uno', archivo: 'no-existe.md', evaluacionRequerida: true,
        ejercicios: [
          { id: 'e', titulo: 'A', enunciado: 'tampoco.md', lenguaje: 'python', pruebas: 'p.json' },
          { id: 'e', titulo: 'B', enunciado: 'tampoco.md' },
        ],
      },
      { id: 'c1', titulo: 'Dos', archivo: 'no-existe.md',
        evaluacion: [
          { pregunta: 'mala', opciones: ['a', 'b'], respuesta: 7 },
          { tipo: 'texto', pregunta: 'sin aceptadas' },
          { tipo: 'vf', pregunta: 'vf', respuesta: 'si' },
        ],
      },
    ],
  }));
  const msgs = validateCourseDir(dir).filter((i) => i.nivel === 'error').map((i) => i.mensaje).join('\n');
  assert.match(msgs, /capítulos: id repetido «c1»/);
  assert.match(msgs, /ejercicios: id repetido «e»/);
  assert.match(msgs, /no existe «no-existe.md»/);
  assert.match(msgs, /evaluacionRequerida/);
  assert.match(msgs, /índice válido/);
  assert.match(msgs, /aceptadas/);
  assert.match(msgs, /true o false/);
});

test('curso.json inválido se reporta como error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curso-'));
  fs.writeFileSync(path.join(dir, 'curso.json'), '{ roto');
  const issues = validateCourseDir(dir);
  assert.equal(issues[0].nivel, 'error');
});

test('rechaza requisitos con comandos peligrosos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curso-'));
  fs.mkdirSync(path.join(dir, 'c'));
  fs.writeFileSync(path.join(dir, 'c', 'm.md'), '# m');
  fs.writeFileSync(path.join(dir, 'curso.json'), JSON.stringify({
    id: 'x', titulo: 'X',
    requisitos: [{ comando: 'rm -rf /' }, { comando: 'gcc', versionArg: '--version; id' }],
    capitulos: [{ id: 'c1', titulo: 'U', archivo: 'c/m.md' }],
  }));
  const msgs = validateCourseDir(dir).filter((i) => i.nivel === 'error').map((i) => i.mensaje).join('\n');
  assert.match(msgs, /«comando» inválido/);
  assert.match(msgs, /«versionArg» inválido/);
});
