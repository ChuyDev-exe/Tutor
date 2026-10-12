# Publicar la extensión

La extensión se publica en **dos registros** para cubrir todos los editores:

| Registro | Editores que lo usan |
|---|---|
| [Visual Studio Marketplace](https://marketplace.visualstudio.com) | VS Code |
| [Open VSX](https://open-vsx.org) | Cursor, Antigravity, VSCodium, Gitpod, Eclipse Theia… |

## Antes de la primera publicación

1. **Publisher.** Crea uno en https://marketplace.visualstudio.com/manage y otro namespace en https://open-vsx.org (mismo nombre). Cambia `"publisher"` en `package.json` (hoy es el marcador `your-publisher-id`).
2. **Repositorio.** Sustituye `your-user` en `repository`, `bugs` y `homepage` por tu URL real. El Marketplace reescribe los enlaces relativos del README a partir de `repository`.
3. **Imágenes del README** (opcional pero recomendable): capturas del panel y de un ejercicio. Deben ser `https://` y no SVG.
4. **Tokens:** un PAT de Azure DevOps con ámbito *Marketplace → Manage* (`VSCE_PAT`) y un token de open-vsx.org (`OVSX_PAT`).

## Publicar una versión

1. Actualiza [CHANGELOG.md](../CHANGELOG.md) (fecha y cambios) y sube la versión: `npm version minor --no-git-tag-version` (edita `package.json`).
2. Comprueba todo en limpio:
   ```bash
   npm ci
   npm test          # 39+ pruebas: lógica, validador, esquemas, soluciones, activación, manifiesto
   npm run package   # typecheck + bundle minificado + .vsix (valida el manifiesto y el contenido)
   ```
   Revisa la lista de archivos que imprime `vsce`: deben ir `dist/`, `media/`, `schemas/`, README, CHANGELOG y LICENSE, y **no** `src/`, `test/`, `examples/`, `docs/` ni `scripts/`.
3. Prueba el `.vsix` real: `code --install-extension tutor-ide-<versión>.vsix` (o *Extensiones → Instalar desde VSIX…* en Cursor/Antigravity) y recorre la guía *Empieza con Tutor IDE*.
4. Publica:
   ```bash
   VSCE_PAT=… npm run publish:vsce
   OVSX_PAT=… npx ovsx publish tutor-ide-<versión>.vsix -p "$OVSX_PAT"
   ```
   La primera vez en Open VSX: `npx ovsx create-namespace <publisher> -p "$OVSX_PAT"` y acepta el acuerdo de publicación en open-vsx.org.
5. O automáticamente: sube una etiqueta `v<versión>` y el workflow `.github/workflows/publish.yml` corre las pruebas, empaqueta y publica en ambos registros (secretos `VSCE_PAT` y `OVSX_PAT` en GitHub). `ci.yml` ejecuta pruebas y empaquetado en cada PR (Linux, macOS y Windows).

> El `.vsix` que pesa unos 130 KB incluye todo el código en `dist/extension.js`; no hay dependencias en tiempo de ejecución.

## Lista de comprobación

- [x] `engines.vscode` ^1.82 (Node 18: `fetch` nativo) y `@types/vscode` fijado a 1.82.0
- [x] Icono PNG 256×256, `galleryBanner`, categorías, palabras clave, licencia (MIT), CHANGELOG y README orientado al usuario
- [x] Código empaquetado con esbuild (un solo archivo, `vscode` externo)
- [x] Declara `capabilities` (no admite espacios de trabajo no confiables ni virtuales) y `extensionKind: workspace`
- [x] Sin telemetría; claves en `SecretStorage`; ajustes sensibles con `scope: application`
- [x] Contenido de cursos tratado como no confiable (requisitos acotados, confirmaciones, protección de rutas)
- [x] Onboarding (walkthrough de 5 pasos), esquemas JSON incluidos en el paquete (`jsonValidation`) y pruebas automáticas (`npm test`)
- [x] Ajustes agrupados en secciones con orden y descripciones; todo ajuste que lee el código está declarado (lo comprueba un test)
- [x] Todos los comandos declarados están registrados y todos los referenciados por menús, atajos y guía existen (lo comprueba un test)
- [x] URLs de repositorio
- [ ] Sustituir el publisher
- [ ] Añadir capturas al README (https, no SVG): el panel con un curso, un ejercicio con su enunciado y el panel de enfoque
- [ ] (Opcional) Traducir la interfaz: hoy todo está en español; no es obligatorio para publicar

## Compatibilidad con otros editores

La extensión usa solo la API pública de VS Code (≥ 1.82) y los comandos integrados `markdown.showPreview*`, por lo que funciona en cualquier fork que los incluya (Cursor, Antigravity, VSCodium, Windsurf…). Requiere un sistema de archivos local y un espacio de trabajo de confianza: no funciona en editores web puros ni en espacios virtuales.
