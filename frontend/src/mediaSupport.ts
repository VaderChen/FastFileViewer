import type { ImageEntry } from './types';

const subtitlePriority = ['.vtt', '.srt', '.ass', '.ssa', '.smi', '.sub'];

export function findSidecarSubtitle(media: ImageEntry, entries: ImageEntry[]): ImageEntry | null {
  if (media.kind !== 'video') {
    return null;
  }
  const mediaStem = fileStem(media.name).toLowerCase();
  return entries
    .filter((entry) => {
      if (entry.kind !== 'subtitle' || entry.directoryPath !== media.directoryPath || entry.source !== media.source) {
        return false;
      }
      if (entry.source === 'archive' && entry.archivePath !== media.archivePath) {
        return false;
      }
      const subtitleStem = fileStem(entry.name).toLowerCase();
      return subtitleStem === mediaStem || subtitleStem.startsWith(`${mediaStem}.`) || subtitleStem.startsWith(`${mediaStem}-`) || subtitleStem.startsWith(`${mediaStem}_`);
    })
    .sort((left, right) => {
      const leftExact = fileStem(left.name).toLowerCase() === mediaStem ? 0 : 1;
      const rightExact = fileStem(right.name).toLowerCase() === mediaStem ? 0 : 1;
      if (leftExact !== rightExact) {
        return leftExact - rightExact;
      }
      const leftPriority = subtitlePriority.indexOf(left.format);
      const rightPriority = subtitlePriority.indexOf(right.format);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.name.localeCompare(right.name);
    })[0] ?? null;
}

export function convertSubtitleToWebVTT(text: string, format: string): string | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return null;
  }
  switch (format.toLowerCase()) {
    case '.vtt':
      return normalized.startsWith('WEBVTT') ? `${normalized}\n` : `WEBVTT\n\n${normalized}\n`;
    case '.srt':
      return convertSRT(normalized);
    case '.ass':
    case '.ssa':
      return convertASS(normalized);
    case '.smi':
      return convertSMI(normalized);
    case '.sub':
      return convertSUB(normalized);
    default:
      return null;
  }
}

export function subtitleLanguageFromName(name: string): string {
  const stem = fileStem(name);
  const compound = stem.match(/(?:^|[._-])([a-z]{2,3})[-_]([a-z]{2})$/i);
  if (compound) {
    return `${compound[1].toLowerCase()}-${compound[2].toUpperCase()}`;
  }
  const parts = stem.split(/[._-]/);
  const candidate = parts[parts.length - 1]?.toLowerCase() ?? '';
  if (candidate === 'cht' || candidate === 'zht') {
    return 'zh-TW';
  }
  if (candidate === 'chs' || candidate === 'zhs') {
    return 'zh-CN';
  }
  if (/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(candidate)) {
    return candidate;
  }
  return 'und';
}

function convertSRT(text: string): string | null {
  const cues: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) {
      continue;
    }
    const timing = lines[timingIndex].replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    const cueText = escapeVTTText(lines.slice(timingIndex + 1).join('\n').trim());
    if (cueText) {
      cues.push(`${timing}\n${cueText}`);
    }
  }
  return buildVTT(cues);
}

function convertASS(text: string): string | null {
  let inEvents = false;
  let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  const cues: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (/^\[events\]$/i.test(line)) {
      inEvents = true;
      continue;
    }
    if (/^\[.+\]$/.test(line)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) {
      continue;
    }
    if (/^format\s*:/i.test(line)) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) {
      continue;
    }
    const values = splitLimited(line.slice(line.indexOf(':') + 1), fields.length);
    const start = assTimeToVTT(values[fields.indexOf('start')] ?? '');
    const end = assTimeToVTT(values[fields.indexOf('end')] ?? '');
    const rawText = values[fields.indexOf('text')] ?? '';
    const cueText = escapeVTTText(rawText.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim());
    if (start && end && cueText) {
      cues.push(`${start} --> ${end}\n${cueText}`);
    }
  }
  return buildVTT(cues);
}

function convertSMI(text: string): string | null {
  const syncPattern = /<sync\b[^>]*\bstart\s*=\s*["']?(\d+)/gi;
  const matches = Array.from(text.matchAll(syncPattern));
  const cues: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const start = Number(current[1]);
    const end = next ? Number(next[1]) : start + 4000;
    const segmentStart = (current.index ?? 0) + current[0].length;
    const segmentEnd = next?.index ?? text.length;
    const cueText = escapeVTTText(decodeBasicEntities(text.slice(segmentStart, segmentEnd)
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim()));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && cueText) {
      cues.push(`${millisecondsToVTT(start)} --> ${millisecondsToVTT(end)}\n${cueText}`);
    }
  }
  return buildVTT(cues);
}

function convertSUB(text: string): string | null {
  const cues: string[] = [];
  for (const line of text.split('\n')) {
    const microDVD = line.match(/^\{(\d+)\}\{(\d+)\}(.*)$/);
    if (microDVD) {
      const start = Math.round(Number(microDVD[1]) * 1000 / 25);
      const end = Math.round(Number(microDVD[2]) * 1000 / 25);
      const cueText = escapeVTTText(microDVD[3].replace(/\|/g, '\n').replace(/\{[^}]*\}/g, '').trim());
      if (end > start && cueText) {
        cues.push(`${millisecondsToVTT(start)} --> ${millisecondsToVTT(end)}\n${cueText}`);
      }
      continue;
    }
    const subViewer = line.match(/^\[(\d{1,2}:\d{2}:\d{2}[.,]\d{2,3})\]\[(\d{1,2}:\d{2}:\d{2}[.,]\d{2,3})\](.*)$/);
    if (subViewer) {
      const cueText = escapeVTTText(subViewer[3].replace(/\[br\]/gi, '\n').trim());
      if (cueText) {
        cues.push(`${normalizeVTTTime(subViewer[1])} --> ${normalizeVTTTime(subViewer[2])}\n${cueText}`);
      }
    }
  }
  return buildVTT(cues);
}

function buildVTT(cues: string[]): string | null {
  return cues.length > 0 ? `WEBVTT\n\n${cues.join('\n\n')}\n` : null;
}

function fileStem(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

function splitLimited(value: string, count: number): string[] {
  const fields: string[] = [];
  let remaining = value;
  for (let index = 1; index < count; index += 1) {
    const commaIndex = remaining.indexOf(',');
    if (commaIndex < 0) {
      break;
    }
    fields.push(remaining.slice(0, commaIndex).trim());
    remaining = remaining.slice(commaIndex + 1);
  }
  fields.push(remaining.trim());
  return fields;
}

function assTimeToVTT(value: string): string | null {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (!match) {
    return null;
  }
  const milliseconds = match[4].length === 1 ? Number(match[4]) * 100 : match[4].length === 2 ? Number(match[4]) * 10 : Number(match[4]);
  return millisecondsToVTT((((Number(match[1]) * 60) + Number(match[2])) * 60 + Number(match[3])) * 1000 + milliseconds);
}

function normalizeVTTTime(value: string): string {
  const [whole, fraction = '0'] = value.replace(',', '.').split('.');
  return `${whole.padStart(8, '0')}.${fraction.padEnd(3, '0').slice(0, 3)}`;
}

function millisecondsToVTT(value: number): string {
  const milliseconds = Math.max(0, Math.round(value));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
}

function escapeVTTText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}
