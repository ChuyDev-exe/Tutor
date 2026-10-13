const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// Mock profundo de `vscode`: cualquier miembro existe; solo se modelan los que importan.
const registered = new Set();
const deep = () =>
  new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : k === 'prototype' ? {} : deep()),
    apply: () => deep(),
    construct: () => deep(),
  });
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'act-'));
const vscodeMock = new Proxy({}, {
  get(_, k) {
    if (k === 'workspace') {
      return new Proxy({}, {
        get: (_t, m) =>
          m === 'workspaceFolders' ? [{ uri: { fsPath: ws } }]
          : m === 'getConfiguration' ? () => ({ get: (_k, d) => d, update: async () => {} })
          : m === 'createFileSystemWatcher' ? () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} })
          : deep(),
      });
    }
    if (k === 'commands') return { registerCommand: (id) => (registered.add(id), { dispose() {} }), executeCommand: async () => undefined };
    if (k === 'EventEmitter') return class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} };
    if (k === 'TreeItem') return class { constructor(label) { this.label = label; } };
    if (k === 'Uri') return { file: (p) => ({ fsPath: p }), parse: (s) => ({ toString: () => s }) };
    return deep();
  },
});
const orig = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscodeMock : orig.call(this, request, ...rest);
};

test('la extensión activa sin errores y registra todos los comandos declarados', () => {
  const ext = require('../out/extension');
  const context = {
    subscriptions: [],
    extensionPath: path.join(__dirname, '..'),
    globalStorageUri: { fsPath: path.join(ws, '_g') },
    workspaceState: { get: (_k, d) => d, update: async () => {} },
    globalState: { get: () => undefined, update: async () => {} },
    extension: { id: 'test.tutor-ide' },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
  };
  ext.activate(context);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const declared = pkg.contributes.commands.map((c) => c.command);
  const missing = declared.filter((id) => !registered.has(id));
  assert.deepEqual(missing, [], `comandos declarados sin registrar: ${missing.join(', ')}`);
  assert.ok(context.subscriptions.length > 5);
});

test('todos los comandos de menús y walkthroughs existen en contributes.commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const declared = new Set(pkg.contributes.commands.map((c) => c.command));
  const used = [];
  for (const items of Object.values(pkg.contributes.menus)) for (const m of items) used.push(m.command);
  for (const k of pkg.contributes.keybindings) used.push(k.command);
  for (const w of pkg.contributes.walkthroughs) {
    for (const s of w.steps) for (const m of s.description.matchAll(/command:([\w.]+)/g)) used.push(m[1]);
  }
  const unknown = used.filter((id) => !declared.has(id) && id !== 'tutor.courseInstalled');
  assert.deepEqual(unknown, [], `referenciados pero no declarados: ${unknown.join(', ')}`);
});

test('el manifiesto cumple lo mínimo para publicar', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const f of ['LICENSE', 'README.md', 'CHANGELOG.md', pkg.icon]) assert.ok(fs.existsSync(path.join(root, f)), `falta ${f}`);
  assert.match(pkg.icon, /\.png$/);
  assert.ok(pkg.publisher && pkg.repository && pkg.license && pkg.engines.vscode);
  assert.ok(pkg.capabilities.untrustedWorkspaces && pkg.capabilities.virtualWorkspaces);
  const props = Object.assign({}, ...pkg.contributes.configuration.map((s) => s.properties));
  for (const k of ['tutor.provider', 'tutor.apiBaseUrl', 'tutor.model']) {
    assert.equal(props[k].scope, 'application', `${k} debe ser application`);
  }
  assert.ok(pkg.contributes.configuration.length >= 4, 'ajustes agrupados en secciones');
  for (const s of pkg.contributes.configuration) assert.ok(s.title && s.order, 'cada sección con título y orden');
  // todo ajuste que el código lee debe estar declarado
  const fsx = require('fs');
  const src = fsx.readdirSync(path.join(root, 'src')).map((f) => fsx.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
  const read = [...src.matchAll(/(?:cfg\(\)|getConfiguration\('tutor'\))\s*\.get(?:<[^>]+>)?\('([\w.]+)'/g)].map((m) => 'tutor.' + m[1]);
  const undeclared = [...new Set(read)].filter((k) => !props[k]);
  assert.deepEqual(undeclared, [], `ajustes leídos pero no declarados: ${undeclared.join(', ')}`);
  const viewIds = pkg.contributes.views['tutor-container'].map((v) => v.id);
  for (const id of ['tutorFocus', 'tutorChapters', 'tutorSearch', 'tutorChat', 'tutorDoubts']) assert.ok(viewIds.includes(id), `vista ${id}`);
  assert.ok(pkg.contributes.jsonValidation.every((j) => fsx.existsSync(path.join(root, j.url))), 'esquemas JSON presentes');
  for (const w of pkg.contributes.walkthroughs) {
    for (const s of w.steps) assert.ok(fs.existsSync(path.join(root, s.media.markdown)), `falta ${s.media.markdown}`);
  }
});
