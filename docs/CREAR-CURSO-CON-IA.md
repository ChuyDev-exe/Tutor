# Guía para que una IA genere un curso de Tutor IDE

> **Cómo usar este documento.** Pégalo completo en la conversación con tu IA (o dáselo como archivo) y añade al final el encargo, por ejemplo: *«Crea un curso de C básico para principiantes, 4 capítulos, con ejercicios en C.»* La IA debe devolver una carpeta de curso que la extensión pueda instalar sin cambios. Al final hay un **prompt listo para copiar** (sección 14).
>
> Si eres una IA leyendo esto: sigue **todas** las reglas, genera **todos** los archivos y ejecuta (o pide ejecutar) las dos validaciones de la sección 10 antes de dar el curso por terminado.

---

## 1. Qué es un curso

Un curso es **una carpeta** con un `curso.json` y los archivos que éste referencia. Tutor IDE lo instala y le ofrece al alumno:

- Capítulos que se **desbloquean en orden** (el 2 no existe hasta completar el 1).
- Por capítulo: un **manual** (lectura), **ejercicios** con pruebas automáticas y una **evaluación** opcional.
- Un ejercicio se **resuelve solo** cuando pasan todas sus pruebas; entonces se desbloquea su solución.
- Un capítulo se **completa solo** cuando todos sus ejercicios están resueltos y (si es obligatoria) la evaluación aprobada.

Contrato técnico: [`schemas/curso.schema.json`](../schemas/curso.schema.json). Ejemplo completo y válido: [`docs/plantilla-curso/`](plantilla-curso/). Referencia de campos: [`CURSOS.md`](CURSOS.md).

## 2. Estructura de archivos (obligatoria)

```
<id-del-curso>/
├── curso.json                       # manifiesto (única fuente de verdad)
├── MANUAL.md                        # manual de configuración del entorno
├── setup.sh                         # prepara el entorno (opcional pero recomendado)
├── capitulos/
│   ├── 01-<tema>.md                 # manual del capítulo 1 (lectura)
│   └── 02-<tema>.md
└── ejercicios/
    ├── <ejercicio>-enunciado.md     # qué debe hacer el alumno
    ├── <ejercicio>-solucion.md      # solución (un bloque de código)
    ├── <ejercicio>-pista-1.md       # pistas graduales (1 a 3, opcionales)
    ├── <ejercicio>-plantilla.<ext>  # archivo inicial del alumno
    └── <ejercicio>-pruebas.json     # casos de prueba
```

- Todas las rutas del `curso.json` son **relativas a la carpeta del curso**, con `/` y **sin** `..` ni rutas absolutas.
- Cada archivo referenciado **debe existir**. No referencies archivos que no generes.
- Archivos en UTF-8, saltos de línea `\n`.
- `<id-del-curso>` = el `id` del `curso.json` (minúsculas, dígitos y guiones: `c-basico`).

## 3. `curso.json`

Empieza siempre con `"$schema": "../../schemas/curso.schema.json"` si el curso va dentro de este repositorio (activa autocompletado y validación). Campos:

| Campo | Obligatorio | Notas |
|---|---|---|
| `id` | sí | `^[a-z0-9][a-z0-9-]*$`. No lo cambies después de publicar |
| `titulo` | sí | Nombre visible |
| `descripcion`, `nivel` | no | 1–2 frases; `principiante` / `intermedio` / `avanzado` |
| `version` | recomendado | `1.0.0`. Súbela al cambiar el curso (activa «Actualizar») |
| `manual`, `setup` | no | Rutas a `MANUAL.md` y `setup.sh` |
| `requisitos` | no | Ver sección 7 |
| `dependencias.npm` | no | Paquetes npm que usan los ejercicios JS/TS: `{"react": "18.3.1"}`. Un solo `node_modules` para todo el curso; **no** pongas un `package.json` por ejercicio |
| `capitulos` | sí | Al menos uno, **en orden de estudio** |

**Capítulo:** `id` (único, `c1`, `c2`…), `titulo`, `archivo` (manual, `.md`), `descripcion`, `tags`, `minutos` (entero), `ejercicios`, `evaluacion`, `aprobacion` (1–100, por defecto 70), `evaluacionRequerida` (bool), `barajar` (bool, por defecto true).

**Ejercicio:** `id` (único en el capítulo, `c1-e1`), `titulo`, `enunciado`, `solucion`, `pistas` (lista) o `pista`, `lenguaje`, `plantilla`, `pruebas`.

- `lenguaje` ∈ `python`, `javascript`, `typescript`, `bash`, `c`, `cpp`, `go`.
- `pruebas` **exige** `lenguaje`.
- El `titulo` del ejercicio **da nombre al archivo del alumno** (`Suma de dos números` → `suma-de-dos-numeros.c`). Que sea corto, único dentro del capítulo y sin símbolos raros.
- Un capítulo **sin ejercicios ni evaluación** (teoría) se marca a mano; evítalos salvo que sean necesarios.

## 4. Cómo diseñar los ejercicios y sus pruebas (lo más importante)

Las pruebas ejecutan el programa del alumno **una vez por caso**, le envían `entrada` por la entrada estándar y comparan lo que imprime.

```json
[
  { "nombre": "3 + 4",    "entrada": "3 4\n", "esperado": "7" },
  { "nombre": "con texto", "entrada": "Ana\n", "contiene": "Hola, Ana" }
]
```

Reglas de comparación (así funciona la extensión):

- `esperado`: la salida, **sin espacios ni saltos al inicio/fin**, debe ser **idéntica**. El programa debe terminar con código 0.
- `contiene`: la salida debe **incluir** ese texto.
- Cada caso necesita `esperado` **o** `contiene`. Usa `nombre` descriptivo.
- Tiempo máximo por caso: 15 s (python, javascript, bash) / 30 s (c, cpp, go, typescript).

**Reglas de oro**

1. **La solución del curso debe pasar sus propias pruebas.** Es la causa nº 1 de cursos rotos.
2. **Cuidado con los textos de `input()`.** En Python, `input("Edad: ")` **imprime** `Edad: ` en la salida. Si usas `esperado`, el enunciado debe decir «no imprimas nada más que el resultado» y la solución no debe usar prompts; si el ejercicio pide mensajes, usa `contiene`.
3. **Salida determinista:** sin aleatoriedad, fechas, orden de diccionarios ni rutas del sistema.
4. **Mínimo 3 casos:** uno típico, un **límite** (0, vacío, frontera) y uno distinto (negativo, texto largo…).
5. **Formato exacto en el enunciado:** di qué se lee (orden, separadores) y qué se imprime (texto literal, mayúsculas, signos). Incluye un **ejemplo** de entrada → salida.
6. **Una sola idea por ejercicio.** Escalones pequeños; de 1 a 4 ejercicios por capítulo.
7. **Autocontenidos:** solo biblioteca estándar. Nada de internet, archivos externos ni entrada interactiva imprevista.
8. **`plantilla`:** el archivo inicial del alumno. Debe contener un comentario con la consigna y el mínimo andamiaje (en C: `#include` y `main`), **sin la solución**. Debe poder ejecutarse sin romper el entorno.

**Notas por lenguaje**

| Lenguaje | Leer entrada | Observaciones |
|---|---|---|
| `python` | `input()`, `int(input())`, `sys.stdin` | Se ejecuta con `python3` |
| `javascript` | `require('fs').readFileSync(0, 'utf8')` | Con `node` |
| `c` | `scanf("%d", &n)` | `gcc archivo.c -lm`; declara `gcc` en `requisitos` |
| `cpp` | `std::cin >> n` | `g++`; declara `g++` en `requisitos` |
| `bash` | `read nombre` | Con `bash` |
| `go` | `fmt.Scan(&n)` | `go run`; declara `go` en `requisitos` |

## 5. Contenido de los archivos `.md`

**Manual del capítulo (`capitulos/NN-tema.md`)** — es la lectura previa a los ejercicios.
- Título `# N. Tema`. Entre 300 y 900 palabras. Un concepto nuevo por sección (`##`).
- Cada idea: explicación breve → ejemplo de código corto → qué hace.
- Cierra con «Qué vas a practicar».

**Enunciado (`*-enunciado.md`)** — estructura fija:
```markdown
# Título del ejercicio

Qué debe hacer el programa, en 1–3 frases.

## Entrada
Qué se lee y en qué orden.

## Salida
Qué se imprime, con el texto literal.

## Ejemplo
Entrada: `3 4`  →  Salida: `7`
```

**Solución (`*-solucion.md`)** — **un solo bloque de código** con el lenguaje indicado (` ```c `), el primero del archivo es el que se prueba; después, opcionalmente, 2–4 líneas explicando la idea. No pongas varios bloques alternativos antes del definitivo.

**Pistas (`*-pista-N.md`)** — de 1 a 3, **de menos a más reveladora**: (1) hacia dónde mirar / qué concepto, (2) qué herramienta o función usar, (3) la estructura casi completa **sin** la línea clave. Ninguna debe ser la solución.

## 6. Evaluaciones

En `evaluacion` del capítulo, de **4 a 8 preguntas**:

```json
{ "tipo": "unica",    "pregunta": "…", "opciones": ["a","b","c"], "respuesta": 1, "explicacion": "…" }
{ "tipo": "multiple", "pregunta": "…", "opciones": ["a","b","c","d"], "respuestas": [0,2] }
{ "tipo": "vf",       "pregunta": "…", "respuesta": true }
{ "tipo": "texto",    "pregunta": "…", "aceptadas": ["printf", "printf()"] }
{ "pregunta": "¿Qué imprime?", "codigo": "int x = 5;\nprintf(\"%d\", x + 1);", "opciones": ["5","6"], "respuesta": 1 }
{ "tipo": "arrastrar", "pregunta": "Lleva cada dato a su tipo", "zonas": ["int", "char*", "float"],
  "elementos": [ { "texto": "42", "zona": "int" }, { "texto": "\"hola\"", "zona": "char*" }, { "texto": "3.5f", "zona": "float" } ] }
```

- Índices **desde 0**. `respuesta` es número (unica) o booleano (vf); `respuestas` es lista (multiple).
- `texto`: lista **todas** las variantes razonables en `aceptadas` (no distingue mayúsculas ni acentos).
- **Las opciones se mezclan** en cada intento: nunca escribas «todas las anteriores», «ninguna» ni «la opción B».
- Pon `explicacion` en cada pregunta: es lo que el alumno lee al fallar.
- Mezcla tipos; incluye al menos una pregunta con `codigo`.
- `arrastrar` sirve para **clasificar** (tipos, etapas, categorías): 2–4 zonas y 4–8 elementos; cada `zona` del elemento es el **texto exacto** de una zona. Solo se acierta si todos quedan bien, así que no pongas más de 8.
- `imagen` (pregunta, zona o elemento): ruta relativa a la carpeta del curso (`img/x.png`) o URL `https://`. **No inventes imágenes**: usa solo archivos que existan en el curso. En los Markdown, `![texto](../img/x.png)` con ruta relativa al archivo.
- Distractores plausibles (errores típicos), no absurdos. Evalúa lo enseñado en el manual, no trivia.
- `evaluacionRequerida: true` solo en capítulos clave; `aprobacion` 60–80 normalmente.

## 7. Requisitos, `setup.sh` y `MANUAL.md`

**`requisitos`** — lo que debe existir en la máquina del alumno:
```json
{ "comando": "gcc", "nombre": "GCC", "versionMinima": "9.0", "obligatorio": true,
  "instalar": { "darwin": "xcode-select --install", "linux": "sudo apt install build-essential", "win32": "winget install MSYS2.MSYS2" } }
```
- `comando` es **solo el nombre del ejecutable** (`^[A-Za-z0-9][A-Za-z0-9._+-]*$`). **Nada** de rutas, espacios, `;`, `|`, `$()`. La extensión solo ejecuta `<comando> --version` (o `versionArg`: `-v`, `version`).
- Declara **un requisito por herramienta** que el curso use (`python3`, `gcc`, `node`, `go`…). Incluye `instalar` para `darwin`, `linux` y `win32`.

**`setup.sh`** — el alumno lo ejecuta tras ver un resumen y los riesgos que la extensión detecta. Reglas estrictas:
1. Primera línea `#!/usr/bin/env bash` y `set -euo pipefail`.
2. **Sin `sudo`, sin `curl`/`wget`, sin `eval`, sin `rm -rf`, sin tocar `~` ni `/etc`.**
3. Solo crea o lee archivos dentro de `"${TUTOR_WORKSPACE:-$PWD}"`.
4. **Idempotente:** ejecutarlo dos veces no rompe nada.
5. Comprueba herramientas con `command -v … || { echo "ERROR: …"; exit 1; }` y muestra versiones.
6. Termina con un mensaje claro de qué quedó listo.
La extensión inyecta `TUTOR_WORKSPACE` (carpeta de trabajo) y `TUTOR_COURSE_DIR` (curso instalado).

**`MANUAL.md`** — secciones fijas: `## Requisitos` (tabla herramienta · versión · para qué), `## Instalación` (macOS / Linux / Windows), `## Preparar el entorno` (pasos numerados con los comandos de la extensión), `## Problemas comunes`.

## 8. Redacción accesible (obligatoria)

Los cursos los usan personas con TDAH, autismo, dislexia y lectores de pantalla:

- **Frases cortas** (máx. ~20 palabras) y **un paso por viñeta**. Instrucciones numeradas.
- **Lenguaje literal:** sin ironía, metáforas ni modismos en instrucciones. Si usas una analogía, márcala como tal.
- **No dependas de emojis, colores ni imágenes** para entender algo. Si pones un emoji, que sea decoración prescindible.
- Define cada término técnico **la primera vez**. Usa siempre el mismo nombre para lo mismo.
- Estructura **predecible** en todos los capítulos: Objetivo → Explicación → Ejemplo → Qué vas a practicar.
- Capítulos de **10–25 minutos** (`minutos`). Divide lo largo.
- Tono animado pero sereno; sin presión («debes», «es fácil», «solo tienes que…»).

## 9. Seguridad (no negociable)

- No incluyas `pruebasComando` salvo que sea imprescindible (el alumno debe autorizarlo; los casos JSON bastan casi siempre).
- Nada que descargue o ejecute código remoto, ni que lea secretos, variables de entorno sensibles o archivos fuera de la carpeta del curso/trabajo.
- Los ejercicios no deben requerir red, `sudo` ni instalar paquetes.

## 10. Validación (obligatoria antes de entregar)

Desde la raíz del repositorio de la extensión (`npm install && npm run compile` una vez):

```bash
node scripts/validate-course.js <carpeta-del-curso>     # estructura, archivos, ids, preguntas, requisitos
node scripts/check-solutions.js <carpeta-del-curso>     # cada solución pasa sus pruebas (necesita python3/gcc/node…)
```

Ambos deben terminar **sin errores** (`validate-course` puede dejar *avisos*; justifícalos o corrígelos). Si no puedes ejecutar comandos, haz tú la comprobación mental de la lista de la sección 11 y dilo explícitamente en tu respuesta.

Prueba adicional: en el editor, *Tutor: Importar curso desde carpeta…* y recorre el primer capítulo.

## 11. Lista de comprobación final

- [ ] `id` en minúsculas con guiones; carpeta con el mismo nombre.
- [ ] Cada ruta del `curso.json` existe; no hay archivos sobrantes importantes sin referenciar.
- [ ] Ids de capítulos únicos; ids de ejercicios únicos por capítulo; títulos de ejercicio únicos por capítulo.
- [ ] Cada ejercicio con `pruebas` tiene `lenguaje`, ≥ 3 casos y su solución los pasa.
- [ ] Ningún caso usa `esperado` si la solución imprime prompts de `input()`.
- [ ] Pistas 1→3 de menos a más reveladora; ninguna es la solución.
- [ ] Evaluaciones de 4–8 preguntas con `explicacion`, sin «todas las anteriores» y con índices válidos.
- [ ] `requisitos` solo con nombres de ejecutable; `instalar` para los 3 sistemas.
- [ ] `setup.sh` cumple las 6 reglas; `MANUAL.md` con las 4 secciones.
- [ ] Redacción accesible (sección 8). `version` definida.
- [ ] `validate-course` y `check-solutions` sin errores.

## 12. Errores frecuentes de las IAs

| Error | Consecuencia |
|---|---|
| Referenciar archivos que no se generaron | El curso no carga o el ejercicio queda sin enunciado |
| `respuesta` como letra (`"b"`) o texto | La pregunta se descarta |
| `vf` con `"respuesta": "verdadero"` | Debe ser `true`/`false` |
| `esperado` con la solución imprimiendo prompts | La solución oficial no pasa sus pruebas |
| Pruebas con salida no determinista | Fallos intermitentes |
| `comando` con argumentos (`"gcc -v"`) | Requisito rechazado |
| Ids repetidos | Progreso mezclado entre capítulos/ejercicios |
| Solución con varios bloques de código | Se prueba el primero, que puede ser un borrador |
| Opciones «todas las anteriores» | Se rompe al mezclar las opciones |
| `arrastrar` con una `zona` que no coincide con ninguna | La pregunta se descarta |
| Imágenes que no existen o rutas `../` fuera del curso | No se muestran (`validate-course` las señala) |
| Capítulos de 40+ minutos | Abandono; divide |

## 13. Publicar en un repositorio

**GitHub (recomendado):** sube la carpeta del curso a un repositorio público; cada carpeta con `curso.json` aparece en la vista *Buscar* de quien tenga ese repositorio en `tutor.repoGithub`. La ficha del curso muestra `titulo`, `descripcion`, `nivel`, `version`, `requisitos` y el temario: rellena `descripcion` y `minutos` de cada capítulo, porque la duración del curso es su suma.

**Catálogo propio:** en `catalogo.json` (esquema: [`schemas/catalogo.schema.json`](../schemas/catalogo.schema.json)):
```json
{ "id": "c-basico", "titulo": "C desde cero", "descripcion": "…", "nivel": "principiante",
  "tags": ["c", "gcc"], "version": "1.0.0", "ruta": "cursos/c-basico" }
```
`version` debe coincidir con la del `curso.json`. Los archivos se sirven desde `<carpeta del catálogo>/<ruta>/`.

## 14. Prompt listo para copiar

Pega este bloque (rellenando los `{…}`) **después** del contenido de este documento:

```text
Genera un curso para Tutor IDE siguiendo EXACTAMENTE la guía anterior.

- Tema: {TEMA, p. ej. "Programación en C básica"}
- Público y nivel: {p. ej. "principiantes sin experiencia previa"}
- Lenguaje de los ejercicios: {c | cpp | python | javascript | typescript | bash | go}
- Capítulos: {N, p. ej. 4} de 15–25 minutos, con 2–3 ejercicios y una evaluación cada uno
- Idioma de los textos: {español}
- id del curso: {p. ej. c-basico}

Entrega:
1. La carpeta completa del curso. Si no puedes escribir archivos, muestra cada archivo como
   "### `ruta/relativa`" seguido de su contenido en un bloque de código, en este orden:
   curso.json, MANUAL.md, setup.sh, capítulos, y luego los archivos de cada ejercicio.
2. Una tabla final con cada ejercicio, el número de casos de prueba y confirmación de que la
   solución los pasa.
3. El resultado de `validate-course.js` y `check-solutions.js` (o, si no puedes ejecutarlos,
   la lista de comprobación de la sección 11 con cada punto verificado).
No inventes campos que no estén en el esquema. No dejes TODOs ni marcadores de posición.
```
