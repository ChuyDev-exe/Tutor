# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Añadido
- **Buscar → Repositorio** lista al abrirse los cursos del repositorio de GitHub [ChuyDev-exe/Tutor-Cursos](https://github.com/ChuyDev-exe/Tutor-Cursos) (ajuste `tutor.repoGithub`; `tutor.repoCatalogUrl` sigue funcionando y tiene prioridad). Cada tarjeta muestra nivel, duración y número de capítulos.
- **Ficha del curso:** al hacer clic en un curso se abre una ventana con nombre, descripción, duración total, capítulos, ejercicios, preguntas, requisitos y el **temario** (minutos, ejercicios y evaluación de cada capítulo), con los botones *Descargar/Actualizar* y *Ver en GitHub*. Se cierra con Esc y se puede usar solo con teclado.
- **Evaluaciones gráficas (`"tipo": "arrastrar"`):** el alumno arrastra cada elemento a la zona a la que pertenece; se aprueba si todos están en su sitio. También funciona con clic o teclado. Al calificar, cada elemento mal colocado indica su zona correcta.
- **Imágenes** en las evaluaciones (`imagen` en preguntas, zonas y elementos) y en la documentación (manuales, enunciados, pistas, soluciones y `MANUAL.md`): se copian junto a los archivos del alumno para que la vista previa las muestre.
- **Vista «Dudas»** en el panel Tutor: tus preguntas al tutor y sus respuestas, agrupadas por curso (el curso actual arriba). Clic para abrir la duda en `dudas-y-preguntas.md`; el chat indica en qué curso se guardó.
- `validate-course` y el esquema validan `arrastrar` y avisan de imágenes inexistentes o fuera del curso. La plantilla de curso incluye un ejemplo de ambas cosas.

### Cambiado
- El tutor responde de forma **concisa y directa** (~100 palabras, sin rodeos) y conoce la lista de ejercicios del curso para no resolver ninguno, aunque se lo pidan disfrazado de duda general.
- Con un solo curso instalado, las dudas se guardan en ese curso aunque no haya un capítulo seleccionado.
- Los `#` dentro de bloques de código de una respuesta ya no se convierten en negritas en el archivo de dudas.

## [0.4.0] - 2026-10-12

### Añadido
- **Correr en una terminal interactiva:** los programas que piden datos (`input()`, `scanf`…) ya funcionan; lo que escribes llega al programa y Ctrl+C lo detiene. La salida se sigue pasando al tutor. Ajuste `tutor.correrEnTerminal` (activado por defecto).
- **Respuestas del tutor en streaming** con los tres tipos de proveedor (compatibles con OpenAI, Anthropic y Gemini). El límite de 90 s ahora cuenta el tiempo sin recibir datos, no la duración total.
- `check-solutions.js`: opciones `--capitulo <id>` y `--omitir-faltantes`.
- **Entorno de ejecución automático:** al correr o probar, si la herramienta del lenguaje (python3, node, gcc, go…) está instalada se usa; si no, el tutor ofrece **instalarla** (brew, apt, dnf, pacman o winget, en una terminal visible) o **correr en Docker** sin instalar nada (la imagen se descarga la primera vez y la elección se recuerda por lenguaje). Ajuste `tutor.entorno`: `auto`, `local` o `docker`. En Docker el código corre sin red, con 512 MB de memoria y, en Linux, con tu usuario.
- CI también en Windows.

### Corregido
- C y C++ funcionan en Windows (ya no dependen de `sh -c`) y se compilan **una sola vez** en vez de una vez por caso de prueba. Un error de compilación se muestra como tal.
- TypeScript (`npx`) en Windows.
- Las pruebas automáticas usan la plantilla `docs/plantilla-curso` en lugar de `examples/repo`, que no está en el repositorio (fallaban en la CI de los tres sistemas).
- En C/C++, el texto de un `printf` sin salto de línea aparece antes del `scanf` al correr en la terminal.

## [0.3.0] - 2026-10-10

Reescritura de la experiencia de estudio: todo ocurre en el panel Tutor y en tu propio archivo.

### Añadido

**Estudio**
- Panel único: *Siguiente paso* (una sola sugerencia), capítulos con **un nodo por ejercicio**, barra de progreso por curso, íconos con color y botones por ejercicio (▶ correr, 🧪 pruebas, 💡 solución).
- Los ejercicios abren **tu archivo** y su enunciado `.md` en el editor. La barra de estado muestra **Enunciado · Correr · Pruebas · Pista/Solución** y sigue al ejercicio de la pestaña activa. Los resultados van a *Salida → Tutor*.
- Los ejercicios se **resuelven al pasar sus pruebas** (sin botón manual); los capítulos se completan solos.
- Capítulos que se desbloquean en orden: manual y archivos del siguiente solo existen en disco al completar el anterior.
- Estado en un **archivo `.tutor`** (JSON) con puntero a un almacén fuera del workspace, donde viven soluciones, pruebas y scripts.
- Evaluaciones: opción única, múltiple, verdadero/falso y respuesta corta; código en la pregunta, aprobación configurable, obligatoria, mezcla de opciones, historial de intentos y repetición de las falladas.
- Pistas graduales (`pistas`) guardadas en `<ejercicio>-pistas.md`.
- Panel *Mi progreso*; actualización de cursos por `version`; desinstalar curso; restaurar mi archivo a la plantilla (deja `.bak`).
- Soporte de C y C++ (`gcc`/`g++`).
- Requisitos, `setup.sh` y manual de configuración por curso.

**Tutor con IA**
- Responde también dudas **relacionadas** con el tema (p. ej. C++ en un curso de C).
- Guarda cada pregunta y respuesta en `dudas-y-preguntas.md` (ordenado por día y capítulo; `tutor.guardarDudas`). El tutor ve tus dudas anteriores.
- Conoce tu archivo y la salida de tu última ejecución; atajos de chat (pista, mi error, revisar mi código, explicar el tema, *Mis dudas*).
- Al configurar la IA se abre la página del proveedor para obtener la API key.

**Enfoque, accesibilidad y preferencias**
- **Sesión de enfoque:** panel con anillo de tiempo, tarea actual, meta diaria y estadísticas del día; entorno despejado reversible; aviso suave por inactividad; mensajes de ánimo opcionales; el modo enfoque muestra solo el capítulo actual y silencia los avisos.
- *Anotar un pensamiento* (`pensamientos-pendientes.md`) y atajos de teclado (`Ctrl/Cmd+Alt+T` + `N`, `R`, `T`, `H`, `F`, `P`).
- Perfiles de accesibilidad (TDAH, autismo, dislexia, alto contraste), sin emojis, sin animaciones, tamaño de texto, interlineado, fuente legible, columna estrecha, evaluaciones de una pregunta por pantalla y lectura en voz alta del enunciado.
- Panel **Tutor: Preferencias…** (interruptores, deslizadores, perfiles y vista previa en vivo) y ajustes agrupados en 4 secciones en *Ajustes → Tutor IDE*.

**Para autores de cursos**
- Esquemas JSON (`curso.json`, `catalogo.json`) con autocompletado y validación en el editor.
- `docs/CREAR-CURSO-CON-IA.md` (guía y prompt para generar cursos con IA) y `docs/plantilla-curso/`.
- Comando *Validar estructura de un curso* y `scripts/validate-course.js`; `scripts/check-solutions.js` comprueba que cada solución pasa sus pruebas.
- Repositorio de ejemplo en `examples/` (3 cursos y un workspace listo) con `npm run example`.

**Publicación**
- Icono, banner, licencia MIT, README y CHANGELOG; empaquetado con esbuild (un solo archivo); onboarding (walkthrough).
- Pruebas automáticas (`npm test`), CI en GitHub Actions y workflow de publicación en VS Code Marketplace y Open VSX (Cursor, Antigravity, VSCodium).
- `docs/ARQUITECTURA.md` y `docs/PUBLICAR.md`.

### Cambiado
- **Versión mínima del editor: 1.82** (antes 1.79), por el uso de `fetch` nativo (Node 18).
- La carpeta `.tutor` de versiones anteriores pasa a ser un **archivo**; se migra sola y la anterior queda como `.tutor.bak`.
- El enunciado ya no es un panel aparte: es un `.md` junto a tu archivo.
- Los resultados de correr código y pruebas van al canal *Salida → Tutor* en lugar de un panel lateral.
- *Tutor: Accesibilidad y enfoque…* abre el panel de Preferencias; el menú anterior sigue como *Perfiles de accesibilidad (menú rápido)*.
- Los ids de curso se convierten en nombres de carpeta seguros (sin puntos ni separadores).
- Un ejercicio sin pruebas se resuelve al correrlo sin errores; uno sin ejecución ni pruebas (de lectura), al abrirlo.

### Eliminado
- El ajuste `tutor.coursesPath` (los cursos viven ahora en el `store` de `.tutor`).
- El curso de ejemplo empaquetado en la extensión (ahora está en `examples/`).
- El botón y el checkbox para marcar ejercicios como resueltos a mano.

### Corregido
- Los checkboxes del árbol no hacían nada (se escuchaba un evento que nunca se disparaba).
- Los ajustes `tutor.model` y `tutor.apiBaseUrl` traían valores de OpenAI y se aplicaban a todos los proveedores.
- Los mensajes del chat se escapaban dos veces; el historial podía empezar por un mensaje del asistente (Anthropic y Gemini lo rechazan).
- Un error EPIPE al ejecutar código podía tumbar el proceso de extensiones; la salida de los programas no tenía límite.
- La descarga de cursos omitía los archivos de pruebas y plantillas.
- Los perfiles de accesibilidad no guardaban nada al pulsar Enter en un menú de selección múltiple; ahora se activan o desactivan al elegirlos y muestran su estado.
- Modelos nuevos de OpenAI (o-series, gpt-5): usan `max_completion_tokens` y no envían `temperature`.
- La clave de Gemini viajaba en la URL; ahora va en un encabezado.
- El chat muestra los enlaces de Markdown.
- Se guarda tu archivo antes de ejecutarlo (antes podía correr una versión desactualizada).
- Curso de ejemplo `python-basico`: las pruebas de dos ejercicios exigían salida exacta, pero su solución imprimía los textos de `input()`.

### Seguridad
- Los requisitos de un curso solo pueden ejecutar `ejecutable --version`.
- `pruebasComando` y `setup.sh` requieren confirmación. El diálogo del `setup.sh` lista sus comandos y detecta riesgos (`sudo`, `curl | sh`, `rm -rf`, `eval`…); un script ya aprobado, sin cambios y sin riesgos no vuelve a preguntar.
- Los ajustes de proveedor, modelo y URL de la IA solo se leen a nivel de usuario (un workspace clonado no puede redirigir tu clave).
- Protección frente a rutas `../` en catálogos, ids de curso y archivos descargados; el catálogo solo acepta `http(s)`.
- La extensión exige espacio de trabajo de confianza y no admite espacios virtuales.

## [0.2.0]
- Versión inicial: capítulos, ejercicios, chat con IA, buscador de cursos.
