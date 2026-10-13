import * as fs from 'fs';
import * as path from 'path';
import { RUNTIMES } from './runtimes';
import { isSafeCommand, isSafeVersionArg, markdownImageRefs, zoneIndex } from './pure';

export interface Issue {
  nivel: 'error' | 'aviso';
  mensaje: string;
}

/**
 * Valida la estructura de un curso (curso.json y los archivos que referencia).
 * Pensado para autores: no necesita VS Code.
 */
export function validateCourseDir(dir: string): Issue[] {
  const issues: Issue[] = [];
  const err = (mensaje: string) => issues.push({ nivel: 'error', mensaje });
  const warn = (mensaje: string) => issues.push({ nivel: 'aviso', mensaje });
  const exists = (rel: unknown, what: string, level: 'error' | 'aviso' = 'error') => {
    if (typeof rel !== 'string' || !rel.trim()) return false;
    const abs = path.resolve(dir, rel);
    if (abs !== path.resolve(dir) && !abs.startsWith(path.resolve(dir) + path.sep)) {
      err(`${what}: la ruta «${rel}» sale de la carpeta del curso.`);
      return false;
    }
    if (!fs.existsSync(abs)) {
      (level === 'error' ? err : warn)(`${what}: no existe «${rel}».`);
      return false;
    }
    return true;
  };
  /** Imagen de una pregunta: URL https o archivo del curso. */
  const image = (v: unknown, what: string) => {
    if (v === undefined) return;
    if (typeof v !== 'string' || !v.trim()) return err(`${what}: «imagen» debe ser una ruta o una URL https.`);
    if (/^https:\/\//i.test(v)) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return err(`${what}: «imagen» solo admite rutas del curso o URLs https («${v}»).`);
    exists(v, `${what} › imagen`);
  };
  /** Imágenes locales de un Markdown del curso: avisa de las que faltan o salen del curso. */
  const mdImages = (rel: unknown, what: string) => {
    if (typeof rel !== 'string') return;
    const abs = path.resolve(dir, rel);
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { return; }
    for (const ref of markdownImageRefs(text)) {
      const img = path.resolve(path.dirname(abs), ref.split(/[?#]/)[0]);
      if (!img.startsWith(path.resolve(dir) + path.sep)) err(`${what}: la imagen «${ref}» sale de la carpeta del curso.`);
      else if (!fs.existsSync(img)) warn(`${what}: no existe la imagen «${ref}».`);
    }
  };
  const dup = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err(`${what}: id repetido «${id}».`);
      seen.add(id);
    }
  };

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'curso.json'), 'utf8'));
  } catch (e) {
    return [{ nivel: 'error', mensaje: `curso.json ausente o con JSON inválido (${e instanceof Error ? e.message : e}).` }];
  }

  if (!raw.id) warn('curso.json: falta «id» (se usará el nombre de la carpeta).');
  if (!raw.titulo) warn('curso.json: falta «titulo».');
  if (raw.version !== undefined && !/^\d+(\.\d+)*$/.test(String(raw.version))) err(`«version» debe ser numérica tipo 1.2.0 (es «${raw.version}»).`);
  if (raw.manual && exists(raw.manual, 'manual')) mdImages(raw.manual, 'manual');
  if (raw.setup) exists(raw.setup, 'setup');
  for (const r of raw.requisitos ?? []) {
    if (!r || typeof r.comando !== 'string' || !r.comando.trim()) err('requisitos: cada requisito necesita «comando».');
    else if (!isSafeCommand(r.comando)) err(`requisitos: «comando» inválido «${r.comando}» (solo el nombre del ejecutable, sin rutas ni espacios).`);
    if (r && r.versionArg !== undefined && !isSafeVersionArg(r.versionArg)) err(`requisitos: «versionArg» inválido «${r.versionArg}» (ej: --version, -v, version).`);
  }
  for (const f of raw.archivos ?? []) exists(f, 'archivos');

  const chapters: any[] = Array.isArray(raw.capitulos) ? raw.capitulos : [];
  if (!chapters.length) err('curso.json: «capitulos» está vacío o ausente.');
  dup(chapters.map((c) => String(c?.id)), 'capítulos');

  for (const ch of chapters) {
    const cn = `Capítulo «${ch?.titulo ?? ch?.id}»`;
    if (!ch?.id) err(`${cn}: falta «id».`);
    if (!ch?.archivo) err(`${cn}: falta «archivo» (manual del capítulo).`);
    else if (exists(ch.archivo, `${cn} › archivo`)) mdImages(ch.archivo, `${cn} › archivo`);
    if (ch.aprobacion !== undefined && !(ch.aprobacion >= 1 && ch.aprobacion <= 100)) err(`${cn}: «aprobacion» debe estar entre 1 y 100.`);
    if (ch.evaluacionRequerida && !(ch.evaluacion?.length)) err(`${cn}: «evaluacionRequerida» sin preguntas en «evaluacion».`);

    const exs: any[] = ch.ejercicios ?? [];
    dup(exs.map((e) => String(e?.id)), `${cn} › ejercicios`);
    for (const e of exs) {
      const en = `${cn} › ejercicio «${e?.titulo ?? e?.id}»`;
      if (!e?.id) err(`${en}: falta «id».`);
      if (!e?.titulo) warn(`${en}: falta «titulo».`);
      if (!exists(e?.enunciado, `${en} › enunciado`)) {
        if (!e?.enunciado) err(`${en}: falta «enunciado».`);
      } else mdImages(e.enunciado, `${en} › enunciado`);
      if (e?.solucion) {
        if (exists(e.solucion, `${en} › solucion`)) mdImages(e.solucion, `${en} › solucion`);
      }
      else warn(`${en}: sin «solucion» (el alumno no tendrá nada que ver al resolverlo).`);
      const pistas: string[] = Array.isArray(e?.pistas) ? e.pistas : e?.pista ? [e.pista] : [];
      pistas.forEach((p, i) => exists(p, `${en} › pista ${i + 1}`) && mdImages(p, `${en} › pista ${i + 1}`));
      if (e?.plantilla) exists(e.plantilla, `${en} › plantilla`);
      if (e?.lenguaje && !RUNTIMES[String(e.lenguaje).toLowerCase()] && !e.pruebasComando) {
        warn(`${en}: lenguaje «${e.lenguaje}» sin runtime embebido; usa «pruebasComando» o uno de: ${Object.keys(RUNTIMES).join(', ')}.`);
      }
      if (e?.pruebas) {
        if (!e.lenguaje) err(`${en}: «pruebas» requiere «lenguaje».`);
        if (exists(e.pruebas, `${en} › pruebas`)) {
          try {
            const cases = JSON.parse(fs.readFileSync(path.resolve(dir, e.pruebas), 'utf8'));
            if (!Array.isArray(cases) || !cases.length) err(`${en}: el archivo de pruebas debe ser un arreglo con al menos un caso.`);
            else {
              cases.forEach((c: any, i: number) => {
                if (c?.esperado === undefined && c?.contiene === undefined) err(`${en} › caso ${i + 1}: necesita «esperado» o «contiene».`);
              });
            }
          } catch {
            err(`${en}: el archivo de pruebas no es JSON válido.`);
          }
        }
      } else if (!e?.pruebasComando) {
        warn(`${en}: sin pruebas; se resolverá al correr sin errores${e?.lenguaje ? '' : ' o al abrirlo'}.`);
      }
    }

    const qs: any[] = ch.evaluacion ?? [];
    dup(qs.map((q, i) => String(q?.id ?? `q${i + 1}`)), `${cn} › evaluación`);
    qs.forEach((q, i) => {
      const qn = `${cn} › pregunta ${i + 1}`;
      if (!String(q?.pregunta ?? '').trim()) return err(`${qn}: falta «pregunta».`);
      const tipo = q.tipo ?? 'unica';
      if (!['unica', 'multiple', 'vf', 'texto', 'arrastrar'].includes(tipo)) return err(`${qn}: tipo «${tipo}» desconocido.`);
      image(q.imagen, qn);
      if (tipo === 'arrastrar') {
        const zonas: any[] = Array.isArray(q.zonas) ? q.zonas : [];
        const elementos: any[] = Array.isArray(q.elementos) ? q.elementos : [];
        if (zonas.length < 2) err(`${qn}: «arrastrar» necesita al menos 2 «zonas».`);
        zonas.forEach((z, k) => {
          const zt = typeof z === 'object' && z ? z : { texto: z };
          if (!String(zt.texto ?? '').trim() && !zt.imagen) err(`${qn} › zona ${k + 1}: necesita «texto» o «imagen».`);
          image(zt.imagen, `${qn} › zona ${k + 1}`);
        });
        if (!elementos.length) err(`${qn}: «arrastrar» necesita «elementos».`);
        elementos.forEach((e, j) => {
          const en = `${qn} › elemento ${j + 1}`;
          if (!e || typeof e !== 'object') return err(`${en}: debe ser un objeto { "texto", "zona" }.`);
          if (!String(e.texto ?? '').trim() && !e.imagen) err(`${en}: necesita «texto» o «imagen».`);
          image(e.imagen, en);
          if (zoneIndex(e.zona, zonas) < 0) err(`${en}: «zona» debe ser el índice (0-${Math.max(0, zonas.length - 1)}) o el texto de una zona.`);
        });
        const used = new Set(elementos.map((e) => zoneIndex(e?.zona, zonas)));
        if (zonas.length >= 2 && elementos.length && used.size < 2) warn(`${qn}: todos los elementos van a la misma zona.`);
      } else if (tipo === 'vf') {
        if (typeof q.respuesta !== 'boolean') err(`${qn}: «respuesta» debe ser true o false.`);
      } else if (tipo === 'texto') {
        const acc = Array.isArray(q.aceptadas) ? q.aceptadas : q.respuesta ? [q.respuesta] : [];
        if (!acc.length) err(`${qn}: necesita «aceptadas» (lista de respuestas válidas).`);
      } else {
        const n = Array.isArray(q.opciones) ? q.opciones.length : 0;
        if (n < 2) return err(`${qn}: necesita al menos 2 «opciones».`);
        const answers = (tipo === 'multiple' ? q.respuestas : [q.respuesta ?? q.respuestas?.[0]]) ?? [];
        if (!answers.length || answers.some((a: any) => !Number.isInteger(a) || a < 0 || a >= n)) {
          err(`${qn}: la respuesta correcta no es un índice válido (0-${n - 1}).`);
        }
      }
    });
  }
  return issues;
}

export function formatIssues(issues: Issue[]): string {
  if (!issues.length) return 'Sin problemas: el curso es válido.';
  return issues.map((i) => `${i.nivel === 'error' ? 'ERROR' : 'AVISO'}  ${i.mensaje}`).join('\n');
}
