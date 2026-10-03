import { referenceSpectrum as calculateLogSpectrumAmplitudes } from './mediaReference.mts';
const audioSpectrumMinimumDecibels = -90;
type AudioVisualizationMode = 'spectrum' | 'waveform' | 'both';

export function referenceDrawAudioVisualization(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode,
  frequencyData: Float32Array<ArrayBuffer>,
  waveformData: Uint8Array<ArrayBuffer>,
  idle: boolean,
  mode: AudioVisualizationMode,
  colorsEnabled: boolean,
) {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  const displayWidth = Math.max(320, canvas.clientWidth);
  const displayHeight = Math.max(180, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(displayWidth * pixelRatio);
  const height = Math.floor(displayHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#10251e');
  background.addColorStop(0.55, '#163a2f');
  background.addColorStop(1, '#0b1210');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  if (idle) {
    frequencyData.fill(audioSpectrumMinimumDecibels);
    waveformData.fill(128);
  } else {
    analyser.getFloatFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(waveformData);
  }

  if (mode !== 'waveform') {
    const barCount = 72;
    // 使用整數像素邊界，避免浮點數 fillRect 造成個別柱受到不同程度的抗鋸齒。
    const gap = Math.max(1, Math.round(Math.max(2 * pixelRatio, width * 0.0025)));
    const barWidth = Math.max(1, Math.floor((width - gap * (barCount - 1)) / barCount));
    const amplitudes = calculateLogSpectrumAmplitudes(frequencyData, analyser.context.sampleRate, analyser.fftSize, barCount, idle);
    // Colors 開啟時讓柱狀頻譜的色相緩慢流動；關閉時維持固定綠色。
    const colorPhase = performance.now() * 0.00035;
    // 擴大至包含橘、黃、綠、青、藍與紫藍色系。
    const hueShift = colorsEnabled ? Math.sin(colorPhase) * 105 : 0;
    const barGradient = context.createLinearGradient(0, height, 0, 0);
    barGradient.addColorStop(0, `hsla(${150 + hueShift}, 55%, 48%, 0.9)`);
    barGradient.addColorStop(0.55, `hsla(${164 + hueShift}, 58%, 64%, 0.9)`);
    barGradient.addColorStop(1, `hsla(${145 + hueShift}, 70%, 88%, 0.96)`);
    context.fillStyle = barGradient;
    for (let index = 0; index < barCount; index += 1) {
      const amplitude = amplitudes[index];
      // 不為零振幅補畫固定高度，避免把 FFT 噪聲底線誤認成高頻能量。
      if (amplitude <= 0) {
        continue;
      }
      const barHeight = Math.max(1 * pixelRatio, amplitude * height * 0.78);
      const x = index * (barWidth + gap);
      context.fillRect(x, height - barHeight, barWidth, barHeight);
    }
    if (mode === 'spectrum') {
      return;
    }
  }

  context.beginPath();
  context.lineWidth = Math.max(2 * pixelRatio, 1.5);
  context.strokeStyle = idle ? 'rgba(190, 235, 213, 0.28)' : 'rgba(205, 250, 226, 0.92)';
  context.shadowColor = 'rgba(78, 208, 151, 0.46)';
  context.shadowBlur = 10 * pixelRatio;
  const maximumWaveformPoints = Math.max(320, Math.min(1600, Math.floor(displayWidth * 1.5)));
  const waveformStride = Math.max(1, Math.floor(waveformData.length / maximumWaveformPoints));
  const waveformPointCount = Math.ceil(waveformData.length / waveformStride);
  let waveformPointIndex = 0;
  for (let index = 0; index < waveformData.length; index += waveformStride) {
    const x = waveformPointIndex * width / Math.max(1, waveformPointCount - 1);
    const y = idle ? height * 0.46 : (waveformData[index] / 255) * height * 0.54 + height * 0.18;
    if (waveformPointIndex === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
    waveformPointIndex += 1;
  }
  context.stroke();
}
