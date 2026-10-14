# Tutor IDE

**Aprende a programar sin salir del editor.** Cursos con ejercicios y pruebas automáticas, evaluaciones, progreso guardado, un tutor con IA que te orienta sin hacerte el trabajo y herramientas de enfoque y accesibilidad.

Funciona en **VS Code**, **Cursor**, **Antigravity**, **VSCodium** y cualquier editor compatible con extensiones de VS Code (≥ 1.82).

## Qué puedes hacer

### Estudiar
- **Todo desde un solo panel.** El panel *Tutor* muestra el *Siguiente paso* (lo único que toca hacer ahora), tus capítulos y un nodo por ejercicio. No necesitas el explorador de archivos.
- **Ejercicios en tu propio archivo.** Un clic abre tu `.c`, `.py`, `.js`… y el enunciado al lado. En la barra de estado: **Enunciado · Correr · Pruebas · Pista** (y **Solución** cuando se desbloquea). Los resultados aparecen en *Salida → Tutor*.
- **Se resuelven con pruebas, no con un botón.** Cuando pasan todas las pruebas, el ejercicio queda resuelto y se desbloquea la solución. Las soluciones nunca están en tu carpeta de trabajo.
- **Capítulos que se desbloquean en orden.** El siguiente (su manual y sus archivos) aparece solo al completar el anterior. Un capítulo se completa solo cuando sus ejercicios están resueltos y, si es obligatoria, la evaluación aprobada.
- **Evaluaciones** de opción única, múltiple, verdadero/falso y respuesta corta; con historial de intentos, aprobación configurable y repetición de solo las falladas.
- **Pistas graduales**, una por pulsación, acumuladas en `<ejercicio>-pistas.md`.
- **Errores en tu archivo:** al correr o probar, la línea que señala el compilador o el intérprete se subraya en el editor. Sobre el error, *¿qué significa?* (💡) o el aviso *¿Por qué falla?* de arriba del archivo le pasan la duda al tutor.
- **Repaso espaciado:** las preguntas que fallas vuelven a los 1, 3, 7, 14 y 30 días. Cuando toca, el panel muestra *Repasar N preguntas*.
- **Mi progreso:** resumen por capítulo con pruebas, evaluaciones y racha (se puede ocultar).
- **Actualizaciones de curso por versión**, sin perder tu progreso ni tus archivos.

### Preguntar
- **Tutor con IA en modo mentor** (OpenAI, Claude, Gemini, OpenRouter, Groq, Ollama, LM Studio u otra API compatible). Orienta con preguntas y pistas sin darte la solución de los ejercicios, y **responde también dudas relacionadas con el tema** (p. ej. C++ en un curso de C).
- **Tus dudas quedan guardadas, por curso**: cada pregunta y respuesta se añade a `dudas-y-preguntas.md` en la carpeta del curso en el que estás (las de C nunca se mezclan con las de Python), ordenadas por día y capítulo. La vista **Dudas** del panel Tutor las lista agrupadas por curso; pasa el ratón para leer la respuesta o haz clic para abrirla. El tutor ve tus dudas anteriores y puede enlazarlas con las nuevas.
- Las respuestas del tutor son **cortas y directas**; nunca resuelve los ejercicios ni evaluaciones del curso.
- El chat conoce tu archivo y la salida de tu última ejecución, y tiene atajos: pista, «mi error», revisar mi código, explicar el tema y *Mis dudas*.

### Concentrarte
- **Sesión de enfoque**, pensada para TDAH y para cualquiera que se distraiga con facilidad (se activa con el *modo enfoque*):
  - Panel con **anillo de tiempo**, la **tarea actual** y tu **meta diaria** (minutos, sesiones y ejercicios resueltos hoy).
  - **Entorno despejado** (oculta minimapa, migas de pan y sticky scroll mientras trabajas; se restaura al terminar).
  - **Anotar un pensamiento** que te distrae sin salir de lo que haces: queda en `pensamientos-pendientes.md`.
  - Avisos **suaves** (barra de estado, sin ventanas) y un recordatorio amable si llevas un rato sin actividad.
  - Solo el capítulo actual en el árbol; sin progreso global, buscador ni racha. Mensajes de ánimo tranquilos (opcionales).
- **Accesibilidad:** perfiles (TDAH, autismo, dislexia, alto contraste), sin emojis, sin animaciones, fuente legible, tamaño de texto, interlineado, columna estrecha, lectura en voz alta del enunciado y evaluaciones de una pregunta por pantalla.
- **Preferencias con interfaz propia** (*Tutor: Preferencias…*): interruptores, deslizadores, perfiles combinables y **vista previa en vivo**. Los ajustes también están agrupados en *Ajustes → Tutor*.
- **Atajos** (acordes `Ctrl/Cmd+Alt+T` + tecla): `N` siguiente paso · `R` correr · `T` pruebas · `H` pista · `E` ¿por qué falla? · `F` temporizador · `P` anotar pensamiento.

### Preparar tu entorno
- **Requisitos y setup por curso.** Cada curso declara lo que necesita (p. ej. `gcc`); la extensión lo verifica y te explica cómo instalarlo. Antes de ejecutar un `setup.sh` ves **qué comandos contiene y qué riesgos tiene**.

## Primeros pasos

1. Abre una carpeta de trabajo.
2. Abre el panel **Tutor**: la primera vez se descargan solos los cursos de [ChuyDev-exe/Tutor-Cursos](https://github.com/ChuyDev-exe/Tutor-Cursos). En **Buscar → Repositorio** puedes ver la ficha de cada curso (temario y duración) y descargar los nuevos.
   - **¿Tienes tus propios cursos?** Pega la URL de tu repositorio de GitHub en el buscador de *Repositorio* (o usa **Tutor: Agregar repositorio de cursos…**): sus cursos aparecen junto a los oficiales. También puedes usar **Tutor: Importar curso desde carpeta…**.
3. Sigue el **Siguiente paso** del panel Tutor.

La guía interactiva está en *Ayuda → Introducción → Empieza con Tutor IDE*.

## Qué archivos crea

```
<tu carpeta de trabajo>/
├── .tutor                          # ARCHIVO JSON: progreso, evaluaciones, estadísticas y puntero «store»
└── <id-del-curso>/                 # tu carpeta de trabajo del curso
    ├── MANUAL.md                   # manual de configuración del curso
    ├── dudas-y-preguntas.md        # tus preguntas al tutor y sus respuestas
    ├── pensamientos-pendientes.md  # lo que anotaste para revisar después
    └── 01-variables-y-tipos/       # un directorio por capítulo desbloqueado
        ├── manual.md               # lectura del capítulo
        ├── edad-futura.c           # TU archivo: lo único que editas
        ├── edad-futura.md          # enunciado
        └── edad-futura-pistas.md   # pistas que ya pediste
```

- `store` (dentro de `.tutor`) apunta a una carpeta de datos de la extensión, **fuera de tu workspace**, donde viven los cursos instalados con sus **soluciones, pruebas y scripts**. Así tu carpeta nunca contiene las soluciones.
- Tu trabajo **nunca se sobrescribe**: actualizar un curso solo cambia manuales y enunciados. *Restaurar mi archivo a la plantilla* deja una copia `.bak`.
- `.tutor` se puede respaldar o versionar; si cambia en disco, la extensión lo recarga.

## Cursos

Un curso es una carpeta con un `curso.json`, manuales en Markdown, ejercicios (enunciado, solución, pruebas) y, opcionalmente, un `setup.sh`. Formato completo: [docs/CURSOS.md](docs/CURSOS.md).

**Para autores:** `curso.json` se valida y autocompleta en el editor (esquema JSON incluido); `Tutor: Validar estructura de un curso (autores)` lo revisa y `node scripts/check-solutions.js <curso>` comprueba que cada solución pasa sus propias pruebas.

**¿Vas a generar un curso con una IA?** Dale [docs/CREAR-CURSO-CON-IA.md](docs/CREAR-CURSO-CON-IA.md): contiene las reglas, el esquema, un prompt listo para copiar y una [plantilla](docs/plantilla-curso/) válida.

## Lenguajes con ejecución integrada

Python, JavaScript, TypeScript (vía `npx tsx`), Bash, C y C++ (`gcc`/`g++`) y Go. Para otros, un ejercicio puede declarar un `pruebasComando` (se te pide permiso la primera vez).

## Comandos principales

Todos empiezan por **Tutor:** en la paleta de comandos (`Ctrl/Cmd+Shift+P`).

| Comando | Qué hace |
|---|---|
| Siguiente paso | Abre lo que toca hacer ahora (lectura, ejercicio o evaluación) |
| Ejecutar código / pruebas del ejercicio | Corre tu archivo o sus pruebas |
| Ver enunciado / pista / solución | Abre cada recurso del ejercicio |
| Restaurar mi archivo a la plantilla | Vuelve al inicio (deja `.bak`) |
| ¿Por qué falla mi código? | Lleva el error de la línea actual (o el último fallo) al chat del tutor |
| Repasar preguntas pendientes | Las preguntas falladas que toca repasar hoy |
| Mi progreso | Panel con el avance por capítulo |
| Mis dudas y preguntas · Ver mis pensamientos pendientes | Abren tus archivos de notas |
| Importar curso desde carpeta · Buscar cursos en el repositorio · Agregar / Quitar repositorio de cursos · Eliminar curso (conserva tu progreso si quieres) | Gestión de cursos |
| Verificar requisitos · Ejecutar setup · Abrir manual de configuración | Preparar el entorno del curso |
| Configurar IA del tutor · Establecer API Key | Proveedor, modelo y clave |
| Preferencias… · Perfiles de accesibilidad (menú rápido) | Enfoque y accesibilidad |
| Temporizador de enfoque · Anotar un pensamiento | Sesión de enfoque |
| Validar estructura de un curso (autores) | Revisa un curso antes de publicarlo |
| Reiniciar progreso | Borra progreso, evaluaciones y estadísticas |

## Ajustes

Se editan en **Tutor: Preferencias…** o en *Ajustes → Tutor IDE* (4 secciones):

| Sección | Ajustes |
|---|---|
| Aprendizaje | `tutor.autoCompleteOnPass`, `tutor.guardarDudas`, `tutor.correrEnTerminal`, `tutor.erroresEnEditor`, `tutor.entorno` (auto · local · docker), `tutor.instalarCursosIniciales`, `tutor.repoGithub` (owner/repo), `tutor.repositorios` (tus repositorios), `tutor.repoCatalogUrl` (http/https), `tutor.contentPath` |
| IA del tutor | `tutor.provider`, `tutor.model`, `tutor.apiBaseUrl`, `tutor.language` (solo a nivel de usuario, salvo el idioma) |
| Enfoque | `tutor.focus.modoEnfoque`, `.limpiarEditor`, `.unaPreguntaALaVez`, `.temporizadorAutomatico`, `.minutosTrabajo`, `.minutosDescanso`, `.metaDiaria`, `.avisoInactividad`, `.mensajes` |
| Lectura y accesibilidad | `tutor.accesibilidad.tamanoTexto`, `.espaciado`, `.fuenteLegible`, `.anchoLectura`, `.altoContraste`, `.reducirMovimiento`, `.sinEmojis`, `.ocultarRacha` |

## Privacidad y seguridad

- **Sin telemetría.** La extensión no envía datos de uso a nadie.
- **Tu API key** se guarda en el almacén seguro del sistema (`SecretStorage`), nunca en archivos del proyecto ni en los ajustes.
- **Qué se envía a la IA:** solo cuando chateas, y solo al proveedor que elegiste: tu pregunta, el capítulo y el enunciado actuales, tus preguntas anteriores y —para poder orientarte— tu archivo del ejercicio y la última salida de tus pruebas. Con Ollama o LM Studio todo queda en tu equipo. Puedes desactivar el guardado de dudas con `tutor.guardarDudas`.
- **Código de terceros:** correr tu código y las pruebas ejecuta compiladores e intérpretes **locales**. Los cursos son contenido no confiable:
  - los requisitos solo pueden ser `ejecutable --version`;
  - el `setup.sh` y los `pruebasComando` **piden tu permiso**;
  - antes de ejecutar un `setup.sh` se muestran sus comandos y se **detectan operaciones de riesgo** (`sudo`, `curl | sh`, `rm -rf`, `eval`…; es una revisión automática, no una garantía).
  Instala cursos solo de fuentes en las que confíes.
- Requiere un **espacio de trabajo de confianza** (Workspace Trust) y un sistema de archivos local.
- Los ajustes de IA no se pueden cambiar desde la configuración de un workspace, para que un repositorio clonado no pueda redirigir tu clave.

## Solución de problemas

- *El panel está vacío:* instala o importa un curso (la vista muestra los botones).
- *No aparece el panel «Sesión de enfoque»:* actívalo con el *modo enfoque* en **Tutor: Preferencias…**.
- *«No encontré gcc/python…»:* ejecuta **Tutor: Verificar requisitos del curso** y sigue las instrucciones de instalación de tu sistema; reinicia el editor para refrescar el PATH.
- *El chat dice «falta API key»:* **Tutor: Configurar IA del tutor** abre la página del proveedor para obtenerla.
- *Un perfil de accesibilidad «no cambia nada»:* los perfiles se activan o desactivan al elegirlos y muestran su estado; el efecto del modo enfoque se nota con un curso instalado.
- *El editor se cerró en plena sesión de enfoque:* al volver a abrirlo se restauran minimapa, migas de pan y sticky scroll.

## Desarrollo

```bash
npm install
npm test                 # lógica, validador, esquemas, soluciones de los cursos, carpeta del alumno, activación y manifiesto
npm run example          # repositorio de ejemplo + editor con la extensión (ver examples/README.md)
npm run validate:examples
node scripts/check-solutions.js examples/repo/cursos/*   # las soluciones pasan sus pruebas
npm run package          # genera el .vsix
```

Documentación: [arquitectura](docs/ARQUITECTURA.md) · [formato de cursos](docs/CURSOS.md) · [crear cursos con IA](docs/CREAR-CURSO-CON-IA.md) · [publicar](docs/PUBLICAR.md) · [cambios](CHANGELOG.md).

## Licencia

[MIT](LICENSE)
