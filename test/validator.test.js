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

test('valida preguntas de arrastrar e imágenes de evaluaciones y documentación', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curso-'));
  fs.mkdirSync(path.join(dir, 'img'));
  fs.writeFileSync(path.join(dir, 'img', 'ok.png'), '');
  fs.writeFileSync(path.join(dir, 'cap.md'), '# Cap\n\n![bien](img/ok.png)\n![falta](img/falta.png)\n![fuera](../../etc/x.png)\n');
  fs.writeFileSync(path.join(dir, 'curso.json'), JSON.stringify({
    id: 'x', titulo: 'X',
    capitulos: [{ id: 'c1', titulo: 'Uno', archivo: 'cap.md', evaluacion: [
      { tipo: 'arrastrar', pregunta: 'bien', imagen: 'img/ok.png', zonas: ['A', { texto: 'B', imagen: 'img/ok.png' }],
        elementos: [{ texto: '1', zona: 'A' }, { texto: '2', zona: 1 }] },
      { tipo: 'arrastrar', pregunta: 'zona mala', zonas: ['A'], elementos: [{ texto: '1', zona: 'Z' }, { zona: 0 }] },
      { tipo: 'unica', pregunta: 'imagen ausente', imagen: 'img/no.png', opciones: ['a', 'b'], respuesta: 0 },
      { tipo: 'unica', pregunta: 'esquema raro', imagen: 'file:///etc/passwd', opciones: ['a', 'b'], respuesta: 0 },
    ] }],
  }));
  const issues = validateCourseDir(dir);
  const errs = issues.filter((i) => i.nivel === 'error').map((i) => i.mensaje).join('\n');
  const warns = issues.filter((i) => i.nivel === 'aviso').map((i) => i.mensaje).join('\n');
  assert.doesNotMatch(errs, /pregunta 1/, 'la pregunta bien formada no da errores');
  assert.match(errs, /pregunta 2: «arrastrar» necesita al menos 2 «zonas»/);
  assert.match(errs, /pregunta 2 › elemento 1: «zona» debe ser/);
  assert.match(errs, /pregunta 2 › elemento 2: necesita «texto» o «imagen»/);
  assert.match(errs, /pregunta 3 › imagen: no existe «img\/no.png»/);
  assert.match(errs, /pregunta 4: «imagen» solo admite/);
  assert.match(errs, /la imagen «..\/..\/etc\/x.png» sale de la carpeta/);
  assert.match(warns, /no existe la imagen «img\/falta.png»/);
});
