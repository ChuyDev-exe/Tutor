#!/usr/bin/env node
// Localiza el CLI de VS Code (o Cursor/Antigravity) aunque `code` no esté en el PATH.
// Uso: node scripts/ide.js dev | example | install <archivo.vsix>
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const mac = (app, bin) => `/Applications/${app}.app/Contents/Resources/app/bin/${bin}`;
const candidates = [
  process.env.TUTOR_IDE_CLI,
  'code',
  mac('Visual Studio Code', 'code'),
  mac('Visual Studio Code - Insiders', 'code-insiders'),
  mac('Cursor', 'cursor'),
  'cursor',
  mac('Antigravity', 'antigravity'),
  'antigravity',
].filter(Boolean);

function works(cmd) {
  if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) return false;
  return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

const cli = candidates.find(works);
if (!cli) {
  console.error(
    'No encontré el CLI de VS Code/Cursor.\n' +
      'En VS Code: Cmd+Shift+P → "Shell Command: Install \'code\' command in PATH",\n' +
      'o define TUTOR_IDE_CLI=/ruta/al/cli. También puedes abrir la carpeta y pulsar F5.'
  );
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const [mode, arg] = process.argv.slice(2);
const args =
  mode === 'install'
    ? ['--install-extension', path.resolve(arg), '--force']
    : mode === 'example'
      ? ['--extensionDevelopmentPath=' + root, path.join(root, 'examples', 'workspace')]
      : ['--extensionDevelopmentPath=' + root, root];
console.log(`> ${cli} ${args.join(' ')}`);
process.exit(spawnSync(cli, args, { stdio: 'inherit' }).status ?? 1);
