# Arquitectura

Resumen técnico de Tutor IDE para quien quiera mantenerla o ampliarla. El comportamiento de cara al usuario está en el [README](../README.md); el formato de los cursos, en [CURSOS.md](CURSOS.md).

## Principios

1. **Todo en un panel.** El alumno no cambia entre el explorador de archivos y la extensión: el árbol Tutor es la navegación.
2. **El progreso se gana, no se marca.** Un ejercicio se resuelve con pruebas; un capítulo, al cumplir sus requisitos.
3. **El contenido de un curso no es confiable.** Todo lo que viene de un curso (requisitos, scripts, comandos de prueba, rutas) se acota o pide permiso.
4. **El trabajo del alumno es sagrado.** Nunca se sobrescribe su archivo; las soluciones viven fuera de su carpeta.
5. **Lógica pura aparte.** Lo que no necesita VS Code vive en módulos sin `import 'vscode'` para poder probarlo con `node --test`.

## Mapa de módulos (`src/`)

| Área | Módulo | Responsabilidad |
|---|---|---|
| Arranque | `extension.ts` | Activa la extensión, crea los gestores y registra todos los comandos, vistas y eventos |
| Estado | `state.ts` | `TutorState`: lee/escribe el archivo `.tutor`, ubica el `store`, migra la carpeta antigua, estadísticas y racha |
| Cursos | `content.ts` | Carga cursos del `store` y de `tutor.contentPath`; búsqueda de texto en capítulos y enunciados |
| | `types.ts` | Interfaces: `Course`, `Chapter`, `Exercise`, `QuizQuestion`, `Requirement`… |
| | `repo.ts` · `searchProvider.ts` | Catálogo remoto, descarga con protección de rutas, comparación de versiones; vista lateral de búsqueda |
| | `validator.ts` | Validación de la estructura de un curso (sin VS Code) |
| Carpeta del alumno | `studentFolder.ts` | Crea manual, archivo del alumno, enunciado y pistas solo de capítulos desbloqueados; nombres seguros |
| Ejecución | `runtimes.ts` | Tabla de lenguajes (comando, compilación previa, extensión, tiempo límite, imagen de Docker y cómo instalarlo); sin `sh -c`, igual en los tres sistemas. `buildCommand` envuelve un comando en `docker run` |
| | `runner.ts` | Ejecuta código y casos de prueba (stdin → stdout), con límite de salida y de tiempo; `pruebasComando` con permiso. C/C++ se compilan una vez antes de correr o de todos los casos |
| | `environment.ts` | Decide dónde correr: herramienta local si existe; si no, instalarla o usar Docker (`tutor.entorno`) |
| | `terminalRun.ts` | *Correr* en una pseudoterminal interactiva: la entrada del alumno llega al programa por stdin y la salida se captura para el tutor |
| | `requirements.ts` | Verifica requisitos (`ejecutable --version`), ejecuta `setup.sh` tras mostrar su análisis, abre manuales |
| Interfaz | `chaptersProvider.ts` | Árbol (siguiente paso → cursos → capítulos → ejercicios) y **toda la lógica de progreso** |
| | `statusBar.ts` | Botones Enunciado / Correr / Pruebas / Pista-Solución, evaluación, progreso y temporizador |
| | `quizView.ts` · `resultsView.ts` · `dashboard.ts` | Evaluaciones (se califican en el host), panel de resultados informativos y *Mi progreso* |
| IA | `aiClient.ts` | Proveedores (OpenAI-compatible, Anthropic, Gemini), claves en `SecretStorage`; respuestas en streaming (SSE) con límite de inactividad |
| | `chatProvider.ts` · `prompt.ts` | Vista de chat y prompt de mentor (con contexto del alumno y dudas anteriores) |
| | `doubts.ts` | Guarda cada pregunta y respuesta en `dudas-y-preguntas.md` |
| Enfoque y accesibilidad | `a11y.ts` | CSS de accesibilidad para los webviews (en vivo), `notify` silencioso, perfiles |
| | `focus.ts` · `focusLayout.ts` · `focusView.ts` · `thoughts.ts` | Temporizador y estadísticas, entorno despejado reversible, panel de la sesión, pensamientos pendientes |
| | `preferences.ts` | Panel de preferencias dirigido por un esquema |
| Utilidades puras | `pure.ts` | `slug`, comparación de versiones, calificación de preguntas, parseo de evaluaciones, requisitos seguros, análisis de scripts |
| | `md.ts` | Renderizado mínimo de Markdown para webviews y nonce de CSP |

## El archivo `.tutor`

JSON en la raíz del workspace (análogo al archivo `.git` de un worktree). Se crea al instalar el primer curso.

```jsonc
{
  "version": 2,
  "store": "…/globalStorage/<id>/workspaces/<hash>",   // fuera del workspace
  "cursos":       { "c-basico": { "instalado": "ISO", "origen": "…" } },
  "progreso":     { "c-basico/c1": true,                // capítulo completo
                    "c-basico/c1/c1-e1": true,          // ejercicio resuelto
                    "c-basico/c1#leido": true },        // manual leído (guía «siguiente paso»)
  "evaluaciones": { "c-basico/c1": { "mejor": {"score": 4, "total": 5},
                                      "intentos": [{ "fecha": "ISO", "score": 4, "total": 5, "aprobado": true }] } },
  "ejercicios":   { "c-basico/c1/c1-e1": { "ejecuciones": 3, "pistas": 1,
                                            "pruebas": { "passed": 2, "total": 3, "fecha": "ISO" } } },
  "actividad":    ["2026-10-10"],
  "confiables":   { "c-basico": ["comando de pruebas autorizado"], "setup:c-basico": ["sha256 del setup.sh aprobado"] },
  "enfoque":      { "2026-10-10": { "minutos": 50, "sesiones": 2, "ejercicios": 3 } }
}
```

El `store` contiene `cursos/<id>/` (curso instalado: soluciones, pruebas, `setup.sh`). Cada cambio guarda el archivo de inmediato; un `FileSystemWatcher` recarga si lo editas fuera.

## Flujos clave

**Instalar un curso** — importar (copia a `store/cursos/<id>`) o descargar (`repo.ts`) → `registerCourse` → recarga → `studentFolder.syncStudentFolder` (solo capítulos desbloqueados) → valida requisitos.

**Entrar a un ejercicio** (`tutor.openExercise`) — comprobar desbloqueo → `ensureExerciseFile` (plantilla, sin pisar) → abrir el archivo → `ensureStatement` + vista previa Markdown al lado → devolver el foco al código. `statusBar` y el chat siguen al ejercicio activo (`followEditor`).

**Correr / probar** — guarda el documento → `runner` ejecuta por caso → `recordExercise` → resultado a *Salida → Tutor* y contexto del chat (`lastOutput`). Si pasan todas las pruebas: `setExerciseDone` → `onDidChangeProgress` → `tryAutoComplete` del capítulo → si se completa, `syncStudentFolder` materializa el siguiente.

**Evaluación** — `quizView` baraja y envía preguntas **sin** las respuestas; el webview devuelve las elegidas y el host califica con `gradeQuestion`. Un intento completo se registra; la práctica de falladas no.

**Chat y dudas** — `chatProvider` arma el prompt (curso, capítulo, enunciado, tu código, última salida, dudas anteriores) → `aiClient.chat` → muestra la respuesta → `doubts.saveDoubt` la añade a `dudas-y-preguntas.md`.

**Sesión de enfoque** — `FocusTimer` mantiene fase y tiempo, acredita minutos al terminar o parar, y emite *snapshots* que pinta `FocusViewProvider`. Al iniciar trabajo, `FocusLayout` guarda los valores previos de minimapa/migas/sticky scroll y los restaura al terminar (o al reactivar si el editor se cerró a medias).

**Accesibilidad en vivo** — cada webview inserta `a11yHead(nonce)` y se registra; al cambiar un ajuste, `broadcastA11y` envía el CSS nuevo a todos.

## Modelo de seguridad

| Amenaza | Defensa |
|---|---|
| Un curso declara un requisito que ejecuta algo arbitrario | Solo se ejecuta `<ejecutable> <bandera>`, validados por patrón (`isSafeCommand`, `isSafeVersionArg`) |
| Un curso trae un `setup.sh` o un `pruebasComando` dañino | Confirmación modal; el `setup.sh` se analiza (`analyzeScript`) y se muestran sus comandos y riesgos; lo aprobado se recuerda por hash |
| Un catálogo o curso intenta escribir fuera de su carpeta (`../`) | Se resuelve y comprueba cada ruta; ids de curso → `safeName` |
| Un repositorio clonado redirige la IA y roba la clave | `provider`, `model` y `apiBaseUrl` tienen `scope: application`; la clave va en `SecretStorage` |
| Inyección HTML en webviews | CSP con nonce criptográfico; todo texto dinámico se escapa; las respuestas de la IA pasan por un renderizador que escapa primero |
| Respuestas correctas expuestas al alumno | La evaluación se califica en el host; las soluciones no están en su carpeta |
| Un proceso hijo cuelga o inunda la salida | Tiempo límite por lenguaje, tope de 200 KB, `EPIPE` ignorado |
| Workspace no confiable | `capabilities.untrustedWorkspaces.supported = false` |

## Compilación y empaquetado

- `tsc` solo comprueba tipos (`npm run typecheck`) y genera `out/` para las pruebas.
- **esbuild** empaqueta `src/extension.ts` en `dist/extension.js` (CJS, Node 18, `vscode` externo). El `.vsix` solo lleva `dist/`, `media/`, `schemas/` y los documentos de cara al usuario (`.vscodeignore`).
- `@types/vscode` está fijado a la versión mínima de `engines.vscode`: si se usa una API más nueva, no compila.

## Pruebas (`test/`, `node --test`)

| Archivo | Cubre |
|---|---|
| `pure.test.js` | `slug`, versiones, calificación, parseo de evaluaciones, requisitos seguros, análisis de scripts |
| `validator.test.js` | Validador de cursos (ejemplos válidos, errores típicos, comandos peligrosos) |
| `schema.test.js` | Los cursos de ejemplo y la plantilla cumplen los esquemas; los esquemas rechazan errores típicos de una IA; **cada solución pasa sus pruebas** |
| `workspace.test.js` | Carpeta del alumno (desbloqueo, no sobrescribir, `.bak`), pistas, dudas, pensamientos, `.tutor`, estadísticas, ids maliciosos |
| `a11y.test.js` | Perfiles: activar, desactivar, combinar, restablecer, errores |
| `activation.test.js` | Activa la extensión con un mock de `vscode`; todos los comandos declarados están registrados; los menús, atajos y guía solo referencian comandos existentes; todo ajuste leído está declarado; manifiesto publicable |

`vscode-stub.js` simula lo mínimo de la API; `activation.test.js` usa un mock profundo. **No hay pruebas de interfaz real**: lo que se ve en el editor (paneles, árbol, barra de estado) se comprueba a mano con `npm run example` y la lista de [examples/README.md](../examples/README.md).

## Ampliar

- **Nuevo lenguaje:** añadirlo a `runtimes.ts` (con su `imagen` de Docker y sus comandos de `instalar`), al `enum` de `schemas/curso.schema.json` y a la tabla de [CREAR-CURSO-CON-IA.md](CREAR-CURSO-CON-IA.md).
- **Nuevo ajuste:** declararlo en una sección de `package.json`, añadirlo a `SECTIONS` de `preferences.ts` si debe verse en el panel, y a los perfiles si corresponde. Un test falla si se lee un ajuste sin declarar.
- **Nuevo proveedor de IA:** una entrada en `PROVIDERS` de `aiClient.ts`; si no es compatible con OpenAI, una función `xRequest` que arme la petición y sepa leer un evento del stream y una respuesta completa.
- **Nuevo comando:** declararlo en `contributes.commands`, registrarlo en `extension.ts`; los tests verifican ambos extremos.
