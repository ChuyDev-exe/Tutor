# Entorno de pruebas de Tutor IDE

```
examples/
├── repo/                 # «repositorio remoto» simulado
│   ├── catalogo.json
│   └── cursos/
│       ├── python-basico/      # catálogo con «archivos»; evaluaciones de los 4 tipos; plantillas
│       ├── c-basico/           # gcc, setup.sh, plantillas, pistas graduales, evaluación obligatoria
│       └── demo-requisitos/    # requisitos que fallan a propósito
└── workspace/            # carpeta de trabajo vacía (usa el repositorio de GitHub de cursos)
```

## Arrancar

```bash
npm run example          # empaqueta, sirve el repo en :8787 y abre el editor sobre examples/workspace
npm run serve:examples   # solo el servidor (PORT=9000 para cambiar el puerto)
```

Por defecto la vista *Buscar* lista los cursos de GitHub (`tutor.repoGithub`). Para probar con el repositorio local, crea `examples/repo/` y añade `"tutor.repoCatalogUrl": "http://localhost:8787/catalogo.json"` a `examples/workspace/.vscode/settings.json`.

Deja la terminal abierta mientras pruebas las descargas. Si el puerto 8787 está ocupado: `lsof -ti:8787 | xargs kill`.
Para empezar de cero, borra todo en `examples/workspace` salvo `.vscode` (incluido el archivo `.tutor`).

Sin abrir el editor, `npm test` comprueba la lógica, los esquemas, que las soluciones pasen sus pruebas y que la extensión se active. Lo que se **ve** (paneles, árbol, barra de estado) solo se verifica a mano con esta lista.

## 1. Instalar cursos

| # | Qué probar | Cómo |
|---|---|---|
| 1 | Buscar en el repositorio | Vista *Buscar cursos y clases* → pestaña Repositorio → busca `c`, `python`, `demo` |
| 2 | Descarga con lista `archivos` | Descarga **Python desde cero** |
| 3 | Descarga reconstruida desde `curso.json` | Descarga **C desde cero** (trae setup, manual, plantillas y pistas) |
| 4 | Estado e instalación | Aparece un **archivo** `.tutor` (JSON con `store`, `progreso`…) y la carpeta `c-basico/` solo con el capítulo 1 |
| 5 | Importar desde carpeta | *Tutor: Importar curso desde carpeta…* → `examples/repo/cursos/c-basico` (si ya está, pregunta si sobrescribir) |
| 6 | Versiones | La tarjeta muestra «✓ Instalado». Sube `version` en `catalogo.json` y vuelve a buscar: «⬆ Actualizar» (conserva progreso y archivos) |
| 7 | Desinstalar | Menú contextual del curso → *Desinstalar curso* |
| 8 | Búsqueda de clases | Pestaña «Clases»: los capítulos bloqueados no aparecen |

## 2. Preparar el entorno

| # | Qué probar | Cómo |
|---|---|---|
| 9 | Requisitos correctos | Curso de C: *Tutor: Verificar requisitos del curso* (gcc ✔; make ⚠ si falta, es opcional) |
| 10 | Requisitos que fallan | Descarga **Demo**: aviso con *Ver detalles / Abrir manual / Ejecutar setup*; «Correr» queda bloqueado |
| 11 | Setup informativo | *Tutor: Ejecutar setup del curso*: el diálogo lista los comandos y los riesgos. En C crea un `Makefile`. La segunda vez, sin cambios, no vuelve a preguntar |

## 3. Estudiar

| # | Qué probar | Cómo |
|---|---|---|
| 12 | Panel todo-en-uno | «Siguiente paso» arriba, capítulos con un nodo por ejercicio. Manual = clic en el capítulo; evaluación = botón del capítulo |
| 13 | Entrar a un ejercicio | Clic en «Suma de dos números»: se abre el `.c` y el enunciado `.md` al lado, con el cursor en tu código |
| 14 | Barra de estado | **Enunciado · Correr · Pruebas · Pista**; el resultado va a *Salida → Tutor*. Cambia de pestaña a otro ejercicio y la barra lo sigue |
| 15 | Pistas graduales | Pulsa **Pista** varias veces: 1/3, 2/3, 3/3 (se acumulan en `…-pistas.md`) |
| 16 | Resolver con pruebas | Haz que pasen las 3 pruebas: se resuelve solo y aparece **Solución** (no hay botón para marcarlo a mano) |
| 17 | Desbloqueo en orden | Los capítulos 2 y 3 están bloqueados. Resuelve los ejercicios del 1 (y aprueba su evaluación si es obligatoria): se completa **solo** y aparecen el manual y los archivos del 2 |
| 18 | Capítulo con evaluación obligatoria | En C el capítulo 2 exige 100%: sin aprobar la evaluación no se completa |
| 19 | Restaurar mi archivo | Menú contextual del ejercicio → *Restaurar mi archivo a la plantilla* (deja `.bak`) |
| 20 | Mi progreso | *Tutor: Mi progreso* o el icono del gráfico en la barra del panel |
| 21 | Progreso persistente | Revisa el archivo `.tutor`; *Reiniciar progreso* lo vacía |

## 4. Evaluaciones

| # | Qué probar | Cómo |
|---|---|---|
| 22 | Los 4 tipos de pregunta | Evaluación del capítulo 1 de Python: única, verdadero/falso, múltiple, texto y pregunta con código |
| 23 | Repetir falladas | Falla a propósito y pulsa «Repetir solo las falladas» (no cambia tu puntaje ni el historial) |

## 5. Tutor con IA

Necesitas una IA configurada (*Tutor: Configurar IA del tutor* abre la página de claves del proveedor), o un modelo local con Ollama.

| # | Qué probar | Cómo |
|---|---|---|
| 24 | Chat con contexto | Falla una prueba y pulsa «Mi error» en el chat |
| 25 | Dudas relacionadas y guardadas | Pregunta «¿en qué se diferencia de C++?». Se responde y se guarda en `c-basico/dudas-y-preguntas.md`; el botón «Mis dudas» la abre |

## 6. Enfoque y accesibilidad

| # | Qué probar | Cómo |
|---|---|---|
| 26 | Preferencias | *Tutor: Preferencias…*: activa un perfil, mueve los deslizadores de texto y mira la vista previa. Cada perfil muestra su estado y se activa o desactiva al pulsarlo |
| 27 | Sesión de enfoque | Activa «Modo enfoque» (o el perfil Enfoque): aparece el panel **Sesión de enfoque**; pulsa *Iniciar sesión*. El árbol muestra solo el capítulo actual y los ya completados |
| 28 | Entorno despejado | Activa «Entorno despejado durante las sesiones» e inicia una sesión: desaparecen minimapa y migas; al terminar vuelven |
| 29 | Meta diaria | Resuelve ejercicios y mira los puntos del panel llenarse |
| 30 | Pensamientos | `Ctrl/Cmd+Alt+T` y luego `P` (o el enlace del panel): se guarda en `pensamientos-pendientes.md` |
| 31 | Calma y lectura | Perfiles «Calma y claridad» (sin emojis) y «Lectura cómoda» (fuente legible, texto mayor) |
| 32 | Evaluación de una pregunta por pantalla | Ajuste «Evaluaciones de una pregunta por pantalla» y abre una evaluación |

## 7. Para autores

| # | Qué probar | Cómo |
|---|---|---|
| 33 | Esquema en el editor | Abre `examples/repo/cursos/c-basico/curso.json`: autocompletado y errores al escribir |
| 34 | Validar estructura | *Tutor: Validar estructura de un curso (autores)* o `npm run validate:examples` |
| 35 | Comprobar soluciones | `node scripts/check-solutions.js examples/repo/cursos/*` |
| 36 | Plantilla para IA | Copia `docs/plantilla-curso/` e impórtala: es un curso mínimo válido |
