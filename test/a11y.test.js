const test = require('node:test');
const assert = require('node:assert/strict');
const { install } = require('./vscode-stub');
install({ workspace: undefined });
const a11y = require('../out/a11y');

const DEFAULTS = { 'accesibilidad.reducirMovimiento': true, 'accesibilidad.espaciado': 1.5, 'accesibilidad.tamanoTexto': 100 };
function fakeConfig() {
  const store = new Map();
  return {
    store,
    get: (k) => (store.has(k) ? store.get(k) : DEFAULTS[k]),
    update: async (k, v) => { if (v === undefined) store.delete(k); else store.set(k, v); },
  };
}
const profile = (label) => a11y.PROFILES.find((p) => p.label.startsWith(label));

test('activar un perfil escribe todos sus ajustes y queda activo', async () => {
  const c = fakeConfig();
  const p = profile('Enfoque');
  assert.equal(a11y.isProfileActive(p, c), false);
  assert.equal(await a11y.toggleProfile(p, c), true);
  assert.equal(c.get('focus.modoEnfoque'), true);
  assert.equal(c.get('focus.unaPreguntaALaVez'), true);
  assert.equal(a11y.isProfileActive(p, c), true);
});

test('volver a elegirlo lo desactiva y restaura los valores por defecto', async () => {
  const c = fakeConfig();
  const p = profile('Lectura');
  await a11y.toggleProfile(p, c);
  assert.equal(c.get('accesibilidad.tamanoTexto'), 115);
  assert.equal(await a11y.toggleProfile(p, c), false);
  assert.equal(c.get('accesibilidad.tamanoTexto'), 100);
  assert.equal(c.get('accesibilidad.fuenteLegible'), undefined);
  assert.equal(c.store.size, 0);
});

test('perfiles combinados: desactivar uno no rompe el otro (ajustes compartidos)', async () => {
  const c = fakeConfig();
  const enfoque = profile('Enfoque');
  const calma = profile('Calma');
  await a11y.toggleProfile(enfoque, c);
  await a11y.toggleProfile(calma, c);
  assert.ok(a11y.isProfileActive(enfoque, c) && a11y.isProfileActive(calma, c));
  await a11y.toggleProfile(calma, c); // comparten modoEnfoque, ocultarRacha, anchoLectura…
  assert.equal(a11y.isProfileActive(calma, c), false);
  assert.equal(c.get('accesibilidad.sinEmojis'), undefined);
  assert.ok(a11y.isProfileActive(enfoque, c), 'Enfoque debe seguir activo');
});

test('restablecer deja todo en su valor por defecto', async () => {
  const c = fakeConfig();
  for (const p of a11y.PROFILES.slice(0, 4)) await a11y.toggleProfile(p, c);
  await a11y.resetProfiles(c);
  assert.equal(c.store.size, 0);
});

test('un fallo al escribir se propaga (el menú lo muestra al usuario)', async () => {
  const c = { get: () => undefined, update: async () => { throw new Error('no se pudo escribir'); } };
  await assert.rejects(() => a11y.toggleProfile(profile('Alto'), c), /no se pudo escribir/);
});
