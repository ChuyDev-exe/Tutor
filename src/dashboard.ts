import { escapeHtml as e } from './md';
import { ChaptersProvider, exKey, quizPassed } from './chaptersProvider';
import { tutorState } from './state';
import { hideStreak } from './a11y';

/** HTML del panel «Mi progreso» (se pinta en el panel de resultados). */
export function buildDashboard(chapters: ChaptersProvider): string {
  const courses = chapters.allCourses;
  if (!courses.length) {
    return '<h1>📊 Mi progreso</h1><p class="empty">Aún no hay cursos instalados.</p>';
  }
  let exDone = 0;
  let exTotal = 0;
  for (const c of courses) {
    for (const ch of c.capitulos) {
      exTotal += ch.ejercicios.length;
      exDone += ch.ejercicios.filter((x) => chapters.isDone(c.id, exKey(ch.id, x.id))).length;
    }
  }
  const streak = tutorState.streak();
  const days = tutorState.get().actividad.length;
  let html = `<h1>📊 Mi progreso</h1>
<div class="cards">
  <div class="card"><b>${chapters.overallPercent() ?? 0}%</b>progreso global</div>
  <div class="card"><b>${exDone}/${exTotal}</b>ejercicios resueltos</div>
  ${hideStreak() ? '' : `<div class="card"><b>🔥 ${streak}</b>día(s) de racha</div>
  <div class="card"><b>${days}</b>día(s) con actividad</div>`}
</div>`;
  for (const c of courses) {
    const pct = chapters.percent(c);
    html += `<h2>${e(c.titulo)} — ${pct}%</h2><div class="bar"><div style="width:${pct}%"></div></div>
<table><tr><th>Capítulo</th><th>Estado</th><th>Ejercicios</th><th>Pruebas</th><th>Evaluación</th></tr>`;
    c.capitulos.forEach((ch, i) => {
      const unlocked = chapters.isChapterUnlocked(c.id, i);
      const done = chapters.isDone(c.id, ch.id);
      const exs = ch.ejercicios;
      const solved = exs.filter((x) => chapters.isDone(c.id, exKey(ch.id, x.id))).length;
      const tests = exs
        .map((x) => chapters.exerciseRecord(c.id, ch.id, x.id)?.pruebas)
        .filter((t): t is NonNullable<typeof t> => !!t);
      const testTxt = tests.length ? `${tests.reduce((a, t) => a + t.passed, 0)}/${tests.reduce((a, t) => a + t.total, 0)}` : '—';
      const q = chapters.getQuiz(c.id, ch.id);
      const quizTxt = !ch.evaluacion?.length
        ? '—'
        : q
          ? `${quizPassed(ch, q.mejor) ? '✅' : '❌'} ${q.mejor.score}/${q.mejor.total} · ${q.intentos.length} intento(s)`
          : `sin intentar (≥${ch.aprobacion}%${ch.evaluacionRequerida ? ', obligatoria' : ''})`;
      html += `<tr><td>${e(ch.titulo)}</td><td>${!unlocked ? '🔒 bloqueado' : done ? '✅ completo' : '⏳ en curso'}</td>
<td>${exs.length ? `${solved}/${exs.length}` : '—'}</td><td>${testTxt}</td><td>${quizTxt}</td></tr>`;
    });
    html += '</table>';
  }
  return html;
}
