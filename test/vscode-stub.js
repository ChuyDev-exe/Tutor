// Simula lo mínimo de la API de VS Code para probar módulos sin abrir el editor.
const Module = require('module');
const orig = Module._load;

function install({ workspace, config = {} } = {}) {
  Module._load = function (request, ...rest) {
    if (request !== 'vscode') return orig.call(this, request, ...rest);
    return {
      workspace: {
        workspaceFolders: workspace ? [{ uri: { fsPath: workspace } }] : undefined,
        getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }),
      },
      EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} },
      window: { showInformationMessage() {}, showWarningMessage() {}, showErrorMessage() {}, setStatusBarMessage() {} },
      Uri: { file: (p) => ({ fsPath: p }) },
      ConfigurationTarget: { Global: 1 },
    };
  };
}
module.exports = { install };
