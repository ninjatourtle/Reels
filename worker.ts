
interface RenderTask {
  scene: any;
  prevScene?: any;
  imageBitmap: ImageBitmap;
  prevImageBitmap?: ImageBitmap;
  t: number;
  words: string[];
  showSubtitles: boolean;
  transitionProgress?: number; // 0 to 1 for crossfade
}

let canvas: OffscreenCanvas;
let ctx: OffscreenCanvasRenderingContext2D;

self.onmessage = async (e) => {
  const { type, data } = e.data;

  if (type === 'init') {
    canvas = e.data.canvas;
    ctx = canvas.getContext('2d', { alpha: false })!;
    return;
  }

  if (type === 'render_scene') {
    renderFrame(data);
    self.postMessage({ type: 'frame_done' });
  }
};

function renderFrame(data: any) {
  const { scene, imageBitmap, t, words, showSubtitles } = data;
  const { width, height } = canvas;

  // 1. Отрисовка размытого фона (Backdrop)
  ctx.save();
  ctx.filter = 'blur(30px) brightness(0.4)';
  const bgScale = 3.0;
  ctx.drawImage(imageBitmap, -width, -height, width * bgScale, height * bgScale);
  ctx.restore();

  // 2. Основная панель
  const box = scene.panelBox || { x: 0, y: 0, width: 100, height: 100 };
  const sourceX = (box.x / 100) * imageBitmap.width;
  const sourceY = (box.y / 100) * imageBitmap.height;
  const sourceW = (box.width / 100) * imageBitmap.width;
  const sourceH = (box.height / 100) * imageBitmap.height;

  let scale = 1.0, offsetX = 0, offsetY = 0;
  if (scene.motionType === 'ZOOM_IN') scale = 1.0 + t * 0.3;
  else if (scene.motionType === 'ZOOM_OUT') scale = 1.3 - t * 0.3;
  else if (scene.motionType === 'PAN_LEFT') offsetX = -t * 100;
  else if (scene.motionType === 'PAN_RIGHT') offsetX = t * 100;
  else if (scene.motionType === 'SMART_FOCUS') scale = 1.05 + Math.sin(t * Math.PI) * 0.03;

  const imgAspect = sourceW / sourceH;
  const canvasAspect = width / height;
  let drawW, drawH;

  if (imgAspect > canvasAspect) {
    drawW = width * scale;
    drawH = drawW / imgAspect;
  } else {
    drawH = height * scale;
    drawW = drawH * imgAspect;
  }

  ctx.save();
  ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
  
  // Тень для панели
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 50;
  
  ctx.drawImage(imageBitmap, sourceX, sourceY, sourceW, sourceH, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // 3. Анимированный Action FX (Улучшено)
  if (scene.actionFx && scene.actionFx !== 'NONE' && t > 0.2 && t < 0.8) {
    const fxT = (t - 0.2) / 0.6; // локальный прогресс эффекта
    const fxScale = 1.0 + Math.sin(fxT * Math.PI) * 0.2; // эффект пульсации
    const shake = Math.sin(fxT * 20) * 5; // легкое дрожание

    ctx.save();
    ctx.font = 'italic bold 140px Bangers, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(width / 2 + shake, height / 3);
    ctx.scale(fxScale, fxScale);
    
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 30;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 20;
    ctx.strokeText(scene.actionFx, 0, 0);
    
    const gradient = ctx.createLinearGradient(0, -50, 0, 50);
    gradient.addColorStop(0, '#fde047');
    gradient.addColorStop(1, '#f97316');
    ctx.fillStyle = gradient;
    ctx.fillText(scene.actionFx, 0, 0);
    ctx.restore();
  }

  // 4. Субтитры (Улучшено)
  if (showSubtitles) {
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    
    const activeWordIdx = Math.floor(t * words.length);
    const lineY = height - 180;
    
    // Подложка для текста
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(50, lineY - 60, width - 100, 100);

    const fullText = words.join(" ");
    const metrics = ctx.measureText(fullText);
    let currentX = (width - metrics.width) / 2;

    words.forEach((word, idx) => {
      const isHighlight = idx <= activeWordIdx;
      ctx.fillStyle = isHighlight ? '#fde047' : 'white';
      const wordMetrics = ctx.measureText(word + " ");
      
      if (isHighlight && idx === activeWordIdx) {
        ctx.save();
        ctx.scale(1.1, 1.1); // небольшой зум активного слова
        ctx.fillText(word, (currentX + wordMetrics.width / 2) / 1.1, lineY / 1.1);
        ctx.restore();
      } else {
        ctx.fillText(word, currentX + wordMetrics.width / 2, lineY);
      }
      
      currentX += wordMetrics.width;
    });
  }
}
