import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDelimitedText, parseJsonDocument } from '../src/structuredData.ts';
import { filterWorkspaceEntries } from '../src/workspaceFilters.ts';
import { calculateLogSpectrumAmplitudes, convertSubtitleToWebVTT, findNextAudioEntry, findSidecarSubtitle, sidecarSRTPath, sidecarSubtitlePaths, subtitleLanguageFromName } from '../src/mediaSupport.ts';
import { buildImageDisplayLayout, calculateViewportScale, clampZoom } from '../src/imageLayout.ts';
import { removeLibraryEntries, replaceLibraryEntry } from '../src/libraryTree.ts';
import { downloadCandidateDisplayURL, downloadHost, extractDownloadURLs, formatDownloadSize, shouldResolveDownloadPage } from '../src/downloads.ts';
import { extractErrorMessage, isOperationCancelled } from '../src/operations.ts';
import { readThumbnail, storeThumbnail } from '../src/thumbnailCache.ts';
import { formatBytes } from '../src/format.ts';
import type { ImageEntry, LibraryNode } from '../src/types.ts';

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
  assert.equal(sidecarSRTPath(video), '/movie.srt');
  assert.deepEqual(sidecarSubtitlePaths(video), ['/movie.vtt', '/movie.srt']);
  assert.equal(sidecarSRTPath({ ...video, path: '/archive.zip::folder/movie.mkv' }), '/archive.zip::folder/movie.srt');
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

test('maps low-frequency music energy across logarithmic spectrum bars', () => {
  const frequencyData = new Float32Array(16_384).fill(-90);
  frequencyData.fill(-28, 12, 683);
  const amplitudes = calculateLogSpectrumAmplitudes(frequencyData, 48_000, 32_768, 72, false);
  assert.equal(amplitudes.length, 72);
  assert.ok(amplitudes.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(amplitudes.filter((value) => value > 0.08).length > 20);
});

test('covers logarithmic spectrum from 18 Hz through 24 kHz when available', () => {
  const frequencyData = new Float32Array(16_384).fill(-90);
  const sampleRate = 48_000;
  const fftSize = 32_768;
  const binFrequency = sampleRate / fftSize;
  const extendedHighStart = Math.floor(23_900 / binFrequency);
  frequencyData.fill(-24, extendedHighStart);
  const amplitudes = calculateLogSpectrumAmplitudes(frequencyData, sampleRate, fftSize, 72, false);
  assert.ok(amplitudes.slice(-4).some((value) => value > 0.08));
});

test('does not reuse the same resolved FFT bin across adjacent low-frequency bars', () => {
  const frequencyData = new Float32Array(16_384).fill(-90);
  frequencyData[13] = -10;
  const amplitudes = calculateLogSpectrumAmplitudes(frequencyData, 48_000, 32_768, 72, false);
  assert.ok(amplitudes[0] > 0);
  assert.ok(amplitudes[1] > 0);
  assert.notEqual(amplitudes[0], amplitudes[1]);
});

test('advances to the next audio entry while skipping other file kinds', () => {
  const entries = [
    { id: 'song-1', name: 'first.flac', path: '/first.flac', directoryPath: '/', source: 'file', format: '.flac', kind: 'audio', size: 1 },
    { id: 'image', name: 'cover.png', path: '/cover.png', directoryPath: '/', source: 'file', format: '.png', kind: 'image', size: 1 },
    { id: 'song-2', name: 'second.mp3', path: '/second.mp3', directoryPath: '/', source: 'file', format: '.mp3', kind: 'audio', size: 1 },
  ] as const;
  assert.equal(findNextAudioEntry([...entries], 'song-1')?.id, 'song-2');
  assert.equal(findNextAudioEntry([...entries], 'song-2')?.id, 'song-1');
  assert.equal(findNextAudioEntry([entries[0]], 'song-1'), null);
});

test('uses rotated image bounds for zooming and panning', () => {
  const naturalSize = { width: 1200, height: 800 };
  const stageSize = { width: 600, height: 400 };
  assert.equal(calculateViewportScale(naturalSize, stageSize, 'fitArea', 0), 0.5);
  assert.equal(calculateViewportScale(naturalSize, stageSize, 'fitArea', 90), 1 / 3);

  const layout = buildImageDisplayLayout('actual', 'lockRatio', naturalSize, stageSize, 2, 90);
  assert.equal(layout.imageStyle.width, 2400);
  assert.equal(layout.imageStyle.height, 1600);
  assert.equal(layout.surfaceStyle.width, 1600);
  assert.equal(layout.surfaceStyle.height, 2400);
  assert.equal(layout.imageStyle.transform, 'translate(-50%, -50%) rotate(90deg)');
});

test('replaces a trashed original with the saved remux result', () => {
  const buildEntry = (id: string, name: string, format: string): ImageEntry => ({
    id,
    name,
    path: `/library/movies/${name}`,
    directoryPath: '/library/movies',
    source: 'file',
    format,
    kind: 'video',
    size: 10,
  });
  const buildNode = (id: string, images: ImageEntry[], children: LibraryNode[] = []): LibraryNode => ({
    id,
    name: id,
    path: `/library/${id}`,
    kind: 'directory',
    scanned: true,
    images,
    children,
  });

  const sibling = buildEntry('other', 'other.mp4', '.mp4');
  const untouched = buildNode('archive', [buildEntry('kept', 'kept.mp4', '.mp4')]);
  const tree = buildNode('root', [], [
    untouched,
    buildNode('movies', [sibling, buildEntry('original', 'movie.mkv', '.mkv')]),
  ]);

  const replacement = buildEntry('remuxed', 'movie.mp4', '.mp4');
  const updated = replaceLibraryEntry(tree, 'original', replacement);

  assert.deepEqual(updated.children[1].images.map((entry) => entry.id), ['other', 'remuxed']);
  assert.equal(updated.children[1].images[1].name, 'movie.mp4');
  assert.equal(updated.children[0], untouched);
  assert.equal(tree.children[1].images[1].name, 'movie.mkv');
});

test('keeps the library tree untouched when the entry is missing', () => {
  const tree: LibraryNode = {
    id: 'root',
    name: 'root',
    path: '/library',
    kind: 'directory',
    scanned: true,
    images: [],
    children: [],
  };
  const replacement: ImageEntry = {
    id: 'remuxed',
    name: 'movie.mp4',
    path: '/library/movie.mp4',
    directoryPath: '/library',
    source: 'file',
    format: '.mp4',
    kind: 'video',
    size: 10,
  };
  assert.equal(replaceLibraryEntry(tree, 'missing', replacement), tree);
});

test('extracts and normalizes download URLs from pasted text', () => {
  assert.deepEqual(
    extractDownloadURLs('see https://example.com/a.mp4, and http://example.org/b.zip.'),
    ['https://example.com/a.mp4', 'http://example.org/b.zip'],
  );
  assert.deepEqual(extractDownloadURLs('ftp://example.com/file no links here'), []);
  assert.deepEqual(extractDownloadURLs('https://example.com'), ['https://example.com/']);
});

test('resolves only page-like URLs before downloading', () => {
  for (const pageURL of ['https://example.com/videos/demo/', 'https://example.com/watch.html', 'https://example.com/play.php']) {
    assert.equal(shouldResolveDownloadPage(pageURL), true, pageURL);
  }
  for (const fileURL of ['https://example.com/clip.mp4', 'https://example.com/stream.m3u8', 'https://example.com/pack.zip']) {
    assert.equal(shouldResolveDownloadPage(fileURL), false, fileURL);
  }
  assert.equal(shouldResolveDownloadPage('not a url'), false);
});

test('formats download hosts, paths, and sizes for display', () => {
  assert.equal(downloadHost('https://cdn.example.com/a/b.mp4'), 'cdn.example.com');
  assert.equal(downloadHost('broken'), 'broken');
  assert.equal(downloadCandidateDisplayURL('https://example.com/a%20b/c.m3u8'), 'example.com/a b/c.m3u8');
  assert.equal(downloadCandidateDisplayURL('broken'), 'broken');
  assert.equal(formatDownloadSize(512), '512 B');
  assert.equal(formatDownloadSize(1536), '1.5 KB');
  assert.equal(formatDownloadSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatDownloadSize(3 * 1024 * 1024 * 1024), '3.00 GB');
});

test('clamps zoom to the toolbar range', () => {
  assert.equal(clampZoom(0.05), 0.1);
  assert.equal(clampZoom(12), 8);
  assert.equal(clampZoom(1.5), 1.5);
});

test('reads backend operation errors and recognizes cancellation', () => {
  assert.equal(extractErrorMessage(new Error('磁碟空間不足'), 'fallback'), '磁碟空間不足');
  assert.equal(extractErrorMessage(new Error(''), 'fallback'), 'fallback');
  assert.equal(extractErrorMessage('plain failure', 'fallback'), 'plain failure');
  assert.equal(extractErrorMessage({ unexpected: true }, 'fallback'), 'fallback');

  assert.equal(isOperationCancelled(new Error('操作已取消')), true);
  assert.equal(isOperationCancelled('掃描目錄失敗: 操作已取消'), true);
  assert.equal(isOperationCancelled(new Error('磁碟空間不足')), false);
  assert.equal(isOperationCancelled(null), false);
});

test('evicts the least recently used thumbnail once the cache is full', () => {
  const cacheLimit = 200;
  for (let index = 0; index < cacheLimit; index += 1) {
    storeThumbnail(`/lru/${index}.png`, `data:${index}`);
  }
  // 重新讀取最舊的一筆，讓它回到佇列尾端。
  assert.equal(readThumbnail('/lru/0.png'), 'data:0');

  storeThumbnail('/lru/overflow.png', 'data:overflow');
  assert.equal(readThumbnail('/lru/overflow.png'), 'data:overflow');
  assert.equal(readThumbnail('/lru/0.png'), 'data:0');
  assert.equal(readThumbnail('/lru/1.png'), '', '最久沒被讀取的項目應該被淘汰');
  assert.equal(readThumbnail('/lru/199.png'), 'data:199');
});

test('re-storing a thumbnail refreshes it instead of duplicating', () => {
  storeThumbnail('/repeat.png', 'first');
  storeThumbnail('/repeat.png', 'second');
  assert.equal(readThumbnail('/repeat.png'), 'second');
});

test('formats file sizes for the workspace and status bar', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('removes library entries while preserving unaffected branch references', () => {
  const kept = { id: 'keep', name: 'keep.png', path: '/keep.png', directoryPath: '/', source: 'file', format: '.png', kind: 'image', size: 1 } as ImageEntry;
  const removed = { ...kept, id: 'remove', name: 'remove.png', path: '/remove.png' };
  const untouched: LibraryNode = { id: 'untouched', name: 'untouched', path: '/untouched', kind: 'directory', scanned: true, images: [kept], children: [] };
  const affected: LibraryNode = { id: 'affected', name: 'affected', path: '/affected', kind: 'directory', scanned: true, images: [removed], children: [] };
  const root: LibraryNode = { id: 'root', name: 'root', path: '/', kind: 'directory', scanned: true, images: [], children: [untouched, affected] };
  const result = removeLibraryEntries(root, new Set(['remove']));
  assert.equal(result.children[0], untouched);
  assert.notEqual(result.children[1], affected);
  assert.deepEqual(result.children[1].images, []);
});
