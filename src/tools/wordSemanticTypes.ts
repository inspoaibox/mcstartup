import { open } from '@tauri-apps/api/dialog';

export interface SelectedWordFile {
  path: string;
  name: string;
}

export interface WordParagraphRecord {
  id: number;
  documentIndex: number;
  documentName: string;
  paragraphIndex: number;
  text: string;
  charCount: number;
}

export interface WordSimilarityMatch {
  score: number;
  left: WordParagraphRecord;
  right: WordParagraphRecord;
}

export interface WordDuplicateResult {
  documentCount: number;
  paragraphCount: number;
  matches: WordSimilarityMatch[];
}

export interface WordCompareResult {
  leftParagraphCount: number;
  rightParagraphCount: number;
  averageBestScore: number;
  coverage: number;
  matches: WordSimilarityMatch[];
}

export interface WordSemanticSearchHit {
  score: number;
  paragraph: WordParagraphRecord;
}

export interface WordSemanticSearchResult {
  documentCount: number;
  paragraphCount: number;
  hits: WordSemanticSearchHit[];
}

export function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export async function pickWordFiles(multiple = true): Promise<SelectedWordFile[]> {
  const selected = await open({
    multiple,
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  return paths.map((path) => ({ path, name: fileNameFromPath(path) }));
}

export function percent(score: number) {
  return `${Math.round(score * 100)}%`;
}

export function similarityTone(score: number) {
  if (score >= 0.9) return 'text-red-600 dark:text-red-300';
  if (score >= 0.8) return 'text-amber-600 dark:text-amber-300';
  return 'text-teal-600 dark:text-teal-300';
}

export function clampThreshold(value: number) {
  return Math.min(0.99, Math.max(0.1, value));
}
