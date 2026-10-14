import { Chapter, Course } from './types';
import { tutorState } from './state';
import { isDue, reviewAfterAnswer } from './pure';

/**
 * Repaso espaciado: cada pregunta de evaluación fallada vuelve a los 1, 3, 7, 14 y 30 días
 * hasta acertarla en todos ellos. Las tarjetas viven en `.tutor` (campo `repaso`).
 */
const today = (): string => new Date().toISOString().slice(0, 10);
const cardKey = (courseId: string, chapterId: string, questionId: string): string => `${courseId}/${chapterId}/${questionId}`;

/** Actualiza las tarjetas con las respuestas de un intento (evaluación completa, práctica o repaso). */
export function recordReview(courseId: string, chapterId: string, results: { id: string; ok: boolean }[]): void {
  const cards = (tutorState.get().repaso ??= {});
  for (const r of results) {
    const key = cardKey(courseId, chapterId, r.id);
    const next = reviewAfterAnswer(cards[key], r.ok, today());
    if (next) cards[key] = next;
    else delete cards[key];
  }
  tutorState.save();
}

export interface DueReview {
  course: Course;
  chapter: Chapter;
  /** Preguntas del capítulo que toca repasar hoy. */
  ids: string[];
}

/** Preguntas que toca repasar hoy, por capítulo (se ignoran las que ya no existen en el curso). */
export function dueReviews(courses: Course[]): DueReview[] {
  const cards = tutorState.get().repaso ?? {};
  const t = today();
  const out: DueReview[] = [];
  for (const course of courses) {
    for (const chapter of course.capitulos) {
      const ids = (chapter.evaluacion ?? [])
        .filter((q) => {
          const card = cards[cardKey(course.id, chapter.id, q.id)];
          return !!card && isDue(card, t);
        })
        .map((q) => q.id);
      if (ids.length) out.push({ course, chapter, ids });
    }
  }
  return out;
}

export const dueCount = (courses: Course[]): number => dueReviews(courses).reduce((n, r) => n + r.ids.length, 0);
