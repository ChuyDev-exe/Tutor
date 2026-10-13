# Formato de un curso

Un curso es una carpeta con un `curso.json`. Se puede importar desde una carpeta o publicar en un repositorio: un repositorio de GitHub (cada carpeta con `curso.json` es un curso) o un `catalogo.json`.

> **¿Generas el curso con una IA?** Usa [CREAR-CURSO-CON-IA.md](CREAR-CURSO-CON-IA.md) (reglas, prompt y buenas prácticas) y parte de la [plantilla](plantilla-curso/). Este documento es la **referencia de campos**.

## Herramientas para autores

| Herramienta | Qué hace |
|---|---|
| Esquema JSON ([`schemas/curso.schema.json`](../schemas/curso.schema.json)) | Autocompletado y errores al escribir `curso.json` en el editor. Añade `"$schema": "../../schemas/curso.schema.json"` (ajusta la ruta) para usarlo fuera de este repositorio |
| **Tutor: Validar estructura de un curso (autores)** · `node scripts/validate-course.js <carpeta>` | Revisa archivos referenciados, ids repetidos, pruebas, preguntas y requisitos |
| `node scripts/check-solutions.js <carpeta>` | Extrae el primer bloque de código de cada `solucion` y comprueba que **pasa sus pruebas**. `--capitulo <id>` prueba solo un capítulo; `--omitir-faltantes` salta los ejercicios cuyos archivos aún no existen (útil mientras escribes el curso) |
| `npm run validate:examples` | Valida los cursos de `examples/` |

Un curso listo para publicar pasa `validate-course` sin errores y `check-solutions` sin fallos.

```
mi-curso/
├── curso.json
├── MANUAL.md            # manual de configuración (opcional)
├── setup.sh             # prepara el entorno (opcional)
├── capitulos/01-intro.md
├── img/                 # imágenes de manuales, enunciados y evaluaciones (opcional)
│   └── memoria.png
└── ejercicios/
    ├── suma-enunciado.md
    ├── suma-solucion.md
    ├── suma-pista-1.md  # pistas graduales (opcional)
    ├── suma-plantilla.c # contenido inicial del archivo del alumno (opcional)
    └── suma-pruebas.json
```

## curso.json

| Campo | Descripción |
|---|---|
| `id`, `titulo`, `descripcion`, `nivel` | Identificación. El `id` se usa para carpetas y progreso |
| `version` | Versión (`1.2.0`). Si el catálogo publica una mayor, se ofrece *Actualizar* sin perder progreso |
| `manual`, `setup` | Manual de configuración (`.md`) y script `.sh` |
| `requisitos` | Herramientas necesarias (ver abajo) |
| `archivos` | Lista de archivos a descargar (si falta, se reconstruye desde el manifiesto) |
| `capitulos` | Lista de capítulos |

### requisitos

```json
{ "comando": "gcc", "nombre": "GCC", "versionArg": "--version", "versionMinima": "9.0",
  "obligatorio": true,
  "instalar": { "darwin": "xcode-select --install", "linux": "sudo apt install build-essential", "win32": "..." } }
```
Por seguridad `comando` es solo el nombre del ejecutable (sin rutas ni espacios) y `versionArg` una bandera (`--version`, `-v`, `version`). Nada más se ejecuta.

### capítulo

| Campo | Descripción |
|---|---|
| `id`, `titulo`, `descripcion`, `archivo`, `tags` | `archivo` es el manual del capítulo (`.md`) |
| `minutos` | Tiempo estimado |
| `ejercicios` | Lista de ejercicios |
| `evaluacion` | Preguntas (ver abajo) |
| `aprobacion` | % mínimo para aprobar (70) |
| `evaluacionRequerida` | Sin aprobarla no se completa el capítulo |
| `barajar` | Mezcla preguntas y opciones (true) |

Un capítulo se desbloquea al completar el anterior y se completa **solo** cuando sus ejercicios están resueltos (y la evaluación aprobada si es obligatoria). Un capítulo sin ejercicios ni evaluación (teoría) se marca a mano con su checkbox.

### ejercicio

| Campo | Descripción |
|---|---|
| `id`, `titulo` | Identificación |
| `enunciado`, `solucion` | Archivos `.md` |
| `pista` / `pistas` | Una o varias pistas (`.md`), de la más sutil a la más explícita |
| `lenguaje` | `python`, `javascript`, `typescript`, `bash`, `c`, `cpp`, `go` |
| `plantilla` | Archivo con el contenido inicial del archivo del alumno |
| `pruebas` | JSON de casos: `[{ "nombre", "entrada", "esperado" \| "contiene" }]` (stdin → stdout) |
| `pruebasComando` | Alternativa: comando de shell (pide permiso al alumno la primera vez) |

Resolución (no hay botón para marcarlo a mano): con pruebas, al pasarlas todas; sin pruebas pero con lenguaje, al correr sin errores; sin ambos (lectura), al abrirlo. Al resolverlo se desbloquea la solución.

**Comparación de las pruebas:** `esperado` exige salida idéntica (sin espacios ni saltos al inicio/fin) y código de salida 0; `contiene` exige que la salida incluya el texto. Ojo: en Python, `input("texto")` **imprime** el texto; con `esperado` no uses prompts (o usa `contiene`). Tiempo máximo por caso: 15 s (python, javascript, bash) / 30 s (c, cpp, go, typescript).

### Qué ve y qué recibe el alumno

| Elemento del curso | Dónde aparece |
|---|---|
| `archivo` del capítulo | `<curso>/NN-capitulo/manual.md`, solo cuando el capítulo está desbloqueado |
| `plantilla` (o una por defecto) | `<curso>/NN-capitulo/<titulo-del-ejercicio>.<ext>`: el único archivo que edita. **No se sobrescribe nunca** |
| `enunciado` | `…/<titulo-del-ejercicio>.md`, junto al archivo |
| `pistas` | Una por pulsación, acumuladas en `…/<titulo-del-ejercicio>-pistas.md` |
| `solucion`, `pruebas`, `setup` | Solo en el almacén de la extensión; la solución se abre al resolver el ejercicio |
| `manual` | `<curso>/MANUAL.md` |

El nombre del archivo sale del `titulo` del ejercicio (sin acentos ni numeración inicial): hazlo corto y único dentro del capítulo.

### evaluacion

```json
{ "tipo": "unica",    "pregunta": "…", "opciones": ["a","b"], "respuesta": 1 }
{ "tipo": "multiple", "pregunta": "…", "opciones": ["a","b","c"], "respuestas": [0,2] }
{ "tipo": "vf",       "pregunta": "…", "respuesta": true }
{ "tipo": "texto",    "pregunta": "…", "aceptadas": ["print", "print()"] }
{ "tipo": "arrastrar", "pregunta": "Lleva cada valor a su tipo",
  "zonas": ["int", "str", { "texto": "float", "imagen": "img/float.png" }],
  "elementos": [ { "texto": "42", "zona": "int" },
                 { "texto": "\"hola\"", "zona": "str" },
                 { "texto": "3.14", "imagen": "img/pi.png", "zona": 2 } ] }
```
Opcionales: `codigo` (fragmento mostrado bajo la pregunta), `imagen`, `explicacion`, `id`. Las opciones se **mezclan** en cada intento (evita «todas las anteriores»). El alumno puede repetir solo las falladas (no cuenta para su puntaje).

**`arrastrar` (evaluación gráfica):** el alumno arrastra cada elemento a la zona a la que pertenece. También funciona sin ratón: se selecciona el elemento (clic, Enter o espacio) y luego la zona. La pregunta cuenta como **acertada solo si todos los elementos están en su zona**; al calificar, cada elemento mal colocado indica cuál era la suya.
- `zonas`: al menos 2. Cada una es un texto o `{ "texto", "imagen" }`.
- `elementos`: cada uno con `texto`, `imagen` o ambos, y su `zona` correcta: el **texto de la zona** (sin distinguir mayúsculas ni acentos) o su **índice** desde 0. Varios elementos pueden ir a la misma zona.
- Los elementos se mezclan en cada intento si `barajar` está activo; las zonas mantienen su orden.

### Imágenes

**En la documentación** (manual del capítulo, `MANUAL.md`, enunciados, pistas y soluciones): Markdown normal, con rutas relativas al propio archivo.
```markdown
![Pila y montículo](../img/memoria.png)
<img src="../img/memoria.png" width="320" alt="Pila y montículo">
```
Al copiar un Markdown a la carpeta del alumno, la extensión copia también sus imágenes a `<curso>/imagenes/` y corrige los enlaces. Las imágenes deben estar **dentro de la carpeta del curso** (las rutas `../` que salen de ella se ignoran); las URLs `https://` se dejan tal cual.

**En las evaluaciones:** `imagen` en la pregunta (se muestra bajo el enunciado) y en las zonas y elementos de `arrastrar`. Es una ruta **relativa a la carpeta del curso** (`img/diagrama.png`) o una URL `https://`. Formatos: png, jpg, gif, svg, webp.

`validate-course` avisa de las imágenes que no existen o que salen del curso.

## setup.sh

El alumno lo ejecuta con *Tutor: Ejecutar setup del curso*. Antes de correrlo, la extensión muestra **qué comandos contiene** y marca riesgos (`sudo`, `curl | sh`, `rm -rf`, `eval`, descargas, cambios fuera de la carpeta de trabajo…). Escríbelo para que no tenga ninguno:

- `#!/usr/bin/env bash` y `set -euo pipefail`; idempotente; sin red ni `sudo`.
- Solo toca `"${TUTOR_WORKSPACE:-$PWD}"` (el curso instalado está en `TUTOR_COURSE_DIR`).
- Si el script no cambia y no tiene riesgos, tras la primera aprobación no se vuelve a preguntar.

## Actualizar un curso

Sube `version` en `curso.json` (y en `catalogo.json` si usas uno). A quien ya lo tiene instalado se le ofrece **Actualizar**; se reemplazan manuales, enunciados, soluciones y pruebas, y se **conservan su progreso y sus archivos**. No cambies los `id` de capítulos ni de ejercicios entre versiones: el progreso se guarda por esos ids.

## Repositorio de GitHub

Es la forma más simple de publicar: sube cada curso a una carpeta de un repositorio público.

```
mi-repo/
├── c-basico/curso.json …
└── react-basico/curso.json …
```

La vista **Buscar → Repositorio** lista los cursos de `tutor.repoGithub` (por defecto [`ChuyDev-exe/Tutor-Cursos`](https://github.com/ChuyDev-exe/Tutor-Cursos)): cada carpeta con un `curso.json`. Al elegir uno se abre su **ficha** con el temario (capítulos, minutos, ejercicios y preguntas de cada uno), la duración total (suma de `minutos`), requisitos y el botón **Descargar** o **Actualizar**. Se descargan todos los archivos de la carpeta (salvo los ocultos, como `.DS_Store`). Formatos aceptados: `owner/repo`, `owner/repo@rama` o la URL del repositorio.

## catalogo.json

Alternativa a GitHub para servir cursos desde cualquier web. Si `tutor.repoCatalogUrl` tiene valor, se usa en lugar de `tutor.repoGithub`.

```json
{ "nombre": "Mi repositorio",
  "cursos": [{ "id": "c-basico", "titulo": "C desde cero", "descripcion": "…",
               "nivel": "principiante", "tags": ["c"], "version": "1.0.0", "ruta": "cursos/c-basico" }] }
```
Los archivos de cada curso se sirven en `<carpeta del catálogo>/<ruta>/`. Si el curso no lista `archivos`, la extensión los reconstruye desde `curso.json`.
