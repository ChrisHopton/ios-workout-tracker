import { AppData, ProfileSettings, WorkoutSession, WorkoutTemplate } from "../domain/types";
import { JsonObject, makeDocumentKey, UploadDocument, UploadKind } from "./protocol";

export interface DocumentDifference extends UploadDocument { deleted: boolean; }
export type RowDifference = DocumentDifference;
function document(kind: UploadKind, deviceId: string, source: (string | number)[], payload: JsonObject): UploadDocument {
  return { key: makeDocumentKey(kind, deviceId, ...source), kind, payload };
}
function templatePayload(template: WorkoutTemplate): JsonObject {
  return {
    id: template.id, title: template.title,
    exercises: template.exercises.map((target) => ({ ...target })),
    weekdays: [...template.weekdays], ...(template.recurrence ? { recurrence: template.recurrence.kind === "legacy"
      ? { ...template.recurrence, weekdaysA: [...template.recurrence.weekdaysA], weekdaysB: [...template.recurrence.weekdaysB] }
      : { ...template.recurrence } } : {}), archived: template.archived, updatedAt: template.updatedAt,
  };
}
export function makeProfileDocument(settings: ProfileSettings, deviceId: string, label: string): UploadDocument {
  return document("profile", deviceId, ["settings"], { phoneLabel: label, ...settings });
}
export function makeCompletionDocument(): UploadDocument {
  return { key: "completion", kind: "completion", payload: { initialUploadComplete: true } };
}
export function projectMetadata(data: AppData, deviceId: string, label: string): UploadDocument[] {
  const result = [makeProfileDocument(data.settings, deviceId, label)];
  for (const entry of data.bodyWeights ?? [])
    result.push(document("body_weight", deviceId, [entry.id], { ...entry }));
  data.exercises.forEach((exercise, index) => {
    result.push(document("exercise", deviceId, [exercise.id], { ...exercise, index }));
  });
  data.templates.forEach((template, index) => {
    result.push(document("plan", deviceId, [template.id], { ...templatePayload(template), index }));
  });
  data.scheduleRevisions.forEach((revision, index) => {
    result.push(document("schedule", deviceId, [revision.id], {
      id: revision.id, effectiveDate: revision.effectiveDate, anchorMonday: revision.anchorMonday,
      slots: revision.slots.map((slot) => ({ weekday: slot.weekday, workoutIds: [...slot.workoutIds] })),
      templateCount: revision.templates.length, index,
    }));
    revision.templates.forEach((template, templateIndex) => {
      result.push(document("schedule_template", deviceId, [revision.id, templateIndex], {
        revisionId: revision.id, index: templateIndex, template: templatePayload(template),
      }));
    });
  });
  return result;
}
export function projectSession(session: WorkoutSession, deviceId: string): UploadDocument[] {
  const result = [document("workout", deviceId, [session.id], {
    id: session.id, date: session.date, title: session.title, templateId: session.templateId,
    unit: session.unit, status: session.status, startedAt: session.startedAt,
    updatedAt: session.updatedAt, finishedAt: session.finishedAt, exerciseCount: session.exercises.length,
  })];
  session.exercises.forEach((entry, index) => {
    result.push(document("workout_exercise", deviceId, [session.id, index], {
      sessionId: session.id, index, exercise: { ...entry.exercise }, target: { ...entry.target },
      suggestion: { ...entry.suggestion, weights: [...entry.suggestion.weights] },
      sets: entry.sets.map((set) => ({ ...set })),
    }));
  });
  return result;
}
export function projectData(data: AppData, deviceId: string, label: string): UploadDocument[] {
  const result = projectMetadata(data, deviceId, label);
  for (const session of data.sessions) result.push(...projectSession(session, deviceId));
  return result;
}
function equalPayload(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (Array.isArray(first) && Array.isArray(second))
    return first.length === second.length && first.every((item, index) => equalPayload(item, second[index]));
  if (!first || !second || typeof first !== "object" || typeof second !== "object" || Array.isArray(first) || Array.isArray(second)) return false;
  const a = first as Record<string, unknown>;
  const b = second as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equalPayload(a[key], b[key]));
}
export function changedDocuments(beforeDocuments: UploadDocument[], afterDocuments: UploadDocument[]): DocumentDifference[] {
  const before = new Map(beforeDocuments.map((item) => [item.key, item]));
  const after = new Set<string>();
  const result: DocumentDifference[] = [];
  for (const item of afterDocuments) {
    after.add(item.key);
    const previous = before.get(item.key);
    if (!previous || previous.kind !== item.kind || !equalPayload(previous.payload, item.payload)) result.push({ ...item, deleted: false });
  }
  for (const item of beforeDocuments)
    if (!after.has(item.key)) result.push({ ...item, payload: {}, deleted: true });
  return result;
}
export const changedRows = changedDocuments;
