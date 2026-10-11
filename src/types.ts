export interface Exercise {
  id: string;
  titulo: string;
  enunciadoFile: string; // ruta absoluta
  solucionFile: string; // ruta absoluta (puede no existir)
  pistaFile?: string;
  /** Pistas graduales (rutas absolutas), de la más sutil a la más explícita. Incluye `pistaFile`. */
  pistaFiles: string[];
  /** Lenguaje del ejercicio de programación: python, javascript, typescript, bash, go… */
  lenguaje?: string;
  /** Archivo JSON de pruebas (casos stdin → stdout). Relativo a la raíz del curso. */
  pruebas?: string;
  /** Comando personalizado para pruebas (ej: pytest, npm test, go test ./…). */
  pruebasComando?: string;
  /** Plantilla inicial (ruta absoluta) del archivo que edita el alumno. */
  plantillaFile?: string;
}

export type QuizTipo = 'unica' | 'multiple' | 'vf' | 'texto';

/**
 * Pregunta de evaluación.
 *  - unica:    una opción correcta (`respuesta`: índice)
 *  - multiple: varias correctas (`respuestas`: índices); se acierta con el conjunto exacto
 *  - vf:       verdadero/falso (`respuesta`: true | false)
 *  - texto:    respuesta corta; `aceptadas` lista variantes válidas (sin distinguir mayúsculas)
 */
export interface QuizQuestion {
  id: string;
  tipo: QuizTipo;
  pregunta: string;
  /** Fragmento de código opcional mostrado bajo el enunciado. */
  codigo?: string;
  opciones: string[];
  /** Índices correctos (unica/vf: un solo elemento). */
  correctas: number[];
  /** Respuestas válidas para tipo texto. */
  aceptadas: string[];
  explicacion?: string;
}

export interface Chapter {
  id: string;
  titulo: string;
  descripcion: string;
  archivo: string; // ruta absoluta al markdown
  tags: string[];
  ejercicios: Exercise[];
  evaluacion?: QuizQuestion[];
  /** Porcentaje mínimo para aprobar la evaluación (default 70). */
  aprobacion: number;
  /** Si es true, el capítulo no se completa sin aprobar la evaluación. */
  evaluacionRequerida: boolean;
  /** Mezclar preguntas y opciones en cada intento (default true). */
  barajar: boolean;
  /** Tiempo estimado de estudio. */
  minutos?: number;
}

/** Herramienta que el curso necesita en la máquina del estudiante (ej: gcc, python3, node). */
export interface Requirement {
  /** Ejecutable a buscar (se prueba `<comando> <versionArg>`). */
  comando: string;
  /** Nombre legible (default: comando). */
  nombre?: string;
  /** Argumento para obtener la versión (default: --version). */
  versionArg?: string;
  /** Versión mínima (ej: "9.0"); se compara contra el primer número x.y encontrado. */
  versionMinima?: string;
  /** Si es false solo avisa, no bloquea (default: true). */
  obligatorio?: boolean;
  /** Cómo instalarlo, por sistema: { darwin, linux, win32 }. */
  instalar?: Partial<Record<'darwin' | 'linux' | 'win32', string>>;
}

export interface Course {
  id: string;
  titulo: string;
  descripcion: string;
  nivel: string;
  root: string; // directorio raíz del curso
  capitulos: Chapter[];
  source: 'descargado' | 'local';
  requisitos: Requirement[];
  /** Versión del curso (ej. 1.2.0); se compara con la del catálogo para ofrecer actualizaciones. */
  version?: string;
  /** Script .sh (ruta absoluta) que genera los archivos necesarios para correr el curso. */
  setupFile?: string;
  /** Manual de configuración en Markdown (ruta absoluta). */
  manualFile?: string;
}

export interface RepoCourseEntry {
  id: string;
  titulo: string;
  descripcion: string;
  nivel?: string;
  tags?: string[];
  /** Versión publicada; si es mayor que la instalada se ofrece «Actualizar». */
  version?: string;
  ruta?: string; // ruta base relativa al catálogo (default: cursos/<id>)
  archivos?: string[]; // lista de archivos relativos a la ruta base
}

export interface RepoCatalog {
  nombre?: string;
  cursos: RepoCourseEntry[];
}

/** Estado de contexto para el chat (qué está viendo el estudiante). */
export interface TutorContext {
  courseId?: string;
  chapterId?: string;
  exerciseId?: string;
  /** Salida/errores de la última ejecución o prueba del alumno (para el chat). */
  lastOutput?: string;
  /** Archivo del alumno del ejercicio activo (para que el tutor lo lea). */
  studentFile?: string;
}
