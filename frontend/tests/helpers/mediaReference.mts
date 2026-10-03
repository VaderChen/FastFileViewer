import type { ImageEntry } from '../../src/types';
const subtitlePriority = ['.vtt', '.srt', '.ass', '.ssa', '.smi', '.sub'];
const audioSpectrumMinimumDecibels = -90;
const audioSpectrumMaximumDecibels = -10;

// Previous algorithms retained only for differential tests and benchmarks.
export function referenceSpectrum(
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

export function referenceSidecar(media: ImageEntry, entries: ImageEntry[]): ImageEntry | null {
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

function fileStem(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}
