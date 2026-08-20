import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDelimitedText, parseJsonDocument } from '../src/structuredData.ts';
import { filterWorkspaceEntries } from '../src/workspaceFilters.ts';
import { convertSubtitleToWebVTT, findSidecarSubtitle, subtitleLanguageFromName } from '../src/mediaSupport.ts';

test('parses quoted CSV cells and embedded newlines', () => {
  const parsed = parseDelimitedText('name,note\r\nAlice,"hello, world"\r\nBob,"line 1\nline 2"', ',');
  assert.deepEqual(parsed.rows, [
    ['name', 'note'],
    ['Alice', 'hello, world'],
    ['Bob', 'line 1\nline 2'],
  ]);
});

test('parses JSON and reports invalid content', () => {
  assert.deepEqual(parseJsonDocument('{"ok":true}').value, { ok: true });
  assert.notEqual(parseJsonDocument('{broken').error, '');
});

test('filters workspace entries by query, kind, and source', () => {
  const entries = [
    { id: '1', name: 'photo.png', path: '/photo.png', directoryPath: '/', source: 'file', format: '.png', kind: 'image', size: 1 },
    { id: '2', name: 'data.json', path: '/archive.zip::data.json', directoryPath: '/archive.zip', source: 'archive', archivePath: '/archive.zip', innerPath: 'data.json', format: '.json', kind: 'code', size: 2 },
    { id: '3', name: 'clip.mp4', path: '/clip.mp4', directoryPath: '/', source: 'file', format: '.mp4', kind: 'video', size: 3 },
    { id: '4', name: 'captions.srt', path: '/captions.srt', directoryPath: '/', source: 'file', format: '.srt', kind: 'subtitle', size: 4 },
  ] as const;
  assert.deepEqual(filterWorkspaceEntries([...entries], 'data', 'document', 'archive').map((entry) => entry.id), ['2']);
  assert.deepEqual(filterWorkspaceEntries([...entries], '', 'image', 'all').map((entry) => entry.id), ['1']);
  assert.deepEqual(filterWorkspaceEntries([...entries], '', 'media', 'all').map((entry) => entry.id), ['3', '4']);
});

test('matches a same-name sidecar subtitle', () => {
  const video = { id: 'video', name: 'movie.mp4', path: '/movie.mp4', directoryPath: '/', source: 'file', format: '.mp4', kind: 'video', size: 1 } as const;
  const entries = [
    video,
    { id: 'other', name: 'other.srt', path: '/other.srt', directoryPath: '/', source: 'file', format: '.srt', kind: 'subtitle', size: 1 },
    { id: 'subtitle', name: 'movie.zh-TW.srt', path: '/movie.zh-TW.srt', directoryPath: '/', source: 'file', format: '.srt', kind: 'subtitle', size: 1 },
  ] as const;
  assert.equal(findSidecarSubtitle(video, [...entries])?.id, 'subtitle');
  assert.equal(subtitleLanguageFromName('movie.zh-TW.srt'), 'zh-TW');
  assert.equal(subtitleLanguageFromName('movie.cht.srt'), 'zh-TW');
  assert.equal(subtitleLanguageFromName('movie.chs.srt'), 'zh-CN');
});

test('converts common subtitle formats to WebVTT', () => {
  const srt = convertSubtitleToWebVTT('1\r\n00:00:01,250 --> 00:00:03,500\r\n字幕內容', '.srt');
  assert.match(srt ?? '', /^WEBVTT/);
  assert.match(srt ?? '', /00:00:01\.250 --> 00:00:03\.500/);

  const ass = convertSubtitleToWebVTT('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.20,0:00:03.40,Default,,0,0,0,,第一行\\N第二行', '.ass');
  assert.match(ass ?? '', /00:00:01\.200 --> 00:00:03\.400/);
  assert.match(ass ?? '', /第一行\n第二行/);

  const microDVD = convertSubtitleToWebVTT('{25}{50}First|Second', '.sub');
  assert.match(microDVD ?? '', /00:00:01\.000 --> 00:00:02\.000/);
});
