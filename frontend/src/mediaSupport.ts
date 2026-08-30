import type { ImageEntry } from './types';

const subtitlePriority = ['.vtt', '.srt', '.ass', '.ssa', '.smi', '.sub'];
export const audioSpectrumMinimumDecibels = -90;
export const audioSpectrumMaximumDecibels = -10;

export function findNextAudioEntry(entries: ImageEntry[], currentId: string): ImageEntry | null {
  if (entries.length < 2) {
    return null;
  }
  const currentIndex = entries.findIndex((entry) => entry.id === currentId);
  const startIndex = currentIndex >= 0 ? currentIndex : entries.length - 1;
  for (let offset = 1; offset < entries.length; offset += 1) {
    const candidate = entries[(startIndex + offset) % entries.length];
    if (candidate.kind === 'audio' && candidate.id !== currentId) {
      return candidate;
    }
  }
  return null;
}

export function calculateLogSpectrumAmplitudes(
  frequencyData: Float32Array,
  sampleRate: number,
  fftSize: number,
  barCount: number,
  idle: boolean,
): number[] {
  if (barCount <= 0) {
    return [];
  }
  if (idle) {
    return Array.from({ length: barCount }, (_, index) => 0.025 + 0.018 * Math.sin(index * 0.55) ** 2);
  }

  const minimumFrequency = 10;
  const maximumFrequency = Math.max(minimumFrequency, Math.min(20_000, sampleRate / 2));
  const frequencyRatio = maximumFrequency / minimumFrequency;
  const binFrequency = sampleRate / fftSize;
  const rawAmplitudes = Array.from({ length: barCount }, (_, index) => {
    const centerPosition = barCount === 1 ? 0 : index / (barCount - 1);
    const centerFrequency = minimumFrequency * frequencyRatio ** centerPosition;
    return interpolateSpectrumAmplitude(frequencyData, centerFrequency / binFrequency);
  });
  const framePeak = Math.max(0.22, ...rawAmplitudes);
  const automaticGain = Math.min(1.45, 0.92 / framePeak);
  return rawAmplitudes.map((amplitude) => Math.min(1, (amplitude * automaticGain) ** 0.85));
}

function interpolateSpectrumAmplitude(frequencyData: Float32Array, binPosition: number): number {
  const lowerBin = Math.min(frequencyData.length - 1, Math.max(1, Math.floor(binPosition)));
  const upperBin = Math.min(frequencyData.length - 1, lowerBin + 1);
  const fraction = Math.min(1, Math.max(0, binPosition - lowerBin));
  const lowerAmplitude = spectrumDecibelsToAmplitude(frequencyData[lowerBin]);
  const upperAmplitude = spectrumDecibelsToAmplitude(frequencyData[upperBin]);
  return lowerAmplitude + (upperAmplitude - lowerAmplitude) * fraction;
}

function spectrumDecibelsToAmplitude(decibels: number): number {
  if (!Number.isFinite(decibels)) {
    return 0;
  }
  const normalized = Math.min(1, Math.max(0,
    (decibels - audioSpectrumMinimumDecibels) / (audioSpectrumMaximumDecibels - audioSpectrumMinimumDecibels),
  ));
  return normalized ** 1.35;
}

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

// sidecarSRTPath 由影片實際路徑推導同目錄、同檔名的 SRT；也適用 archive::inner/path 格式。
export function sidecarSRTPath(media: ImageEntry): string | null {
  return sidecarSubtitlePaths(media).find((path) => path.toLowerCase().endsWith('.srt')) ?? null;
}

// sidecarSubtitlePaths 回傳播放時可直接嘗試的同名字幕，優先使用 WebVTT。
export function sidecarSubtitlePaths(media: ImageEntry): string[] {
  if (media.kind !== 'video' || !media.path) {
    return [];
  }
  const extensionIndex = media.path.lastIndexOf('.');
  const separatorIndex = Math.max(media.path.lastIndexOf('/'), media.path.lastIndexOf('\\'));
  if (extensionIndex <= separatorIndex) {
    return [];
  }
  const stem = media.path.slice(0, extensionIndex);
  return [`${stem}.vtt`, `${stem}.srt`];
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
  const lines = text.split('\n');
  const timingPattern = /^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*$/;
  for (let index = 0; index < lines.length;) {
    const timingMatch = lines[index].match(timingPattern);
    if (!timingMatch) {
      index += 1;
      continue;
    }
    const start = srtTimeToMilliseconds(timingMatch[1]);
    const end = srtTimeToMilliseconds(timingMatch[2]);
    let nextIndex = index + 1;
    const cueLines: string[] = [];
    while (nextIndex < lines.length && lines[nextIndex].trim() !== '' && !timingPattern.test(lines[nextIndex])) {
      cueLines.push(lines[nextIndex]);
      nextIndex += 1;
    }
    const cueText = escapeVTTText(cueLines.join('\n').trim());
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && cueText) {
      cues.push(`${millisecondsToVTT(start)} --> ${millisecondsToVTT(end)}\n${cueText}`);
    }
    index = nextIndex;
  }
  return buildVTT(cues);
}

function srtTimeToMilliseconds(value: string): number {
  const match = value.trim().replace(',', '.').match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) {
    return Number.NaN;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (minutes > 59 || seconds > 59) {
    return Number.NaN;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
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
