
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Video, Film, Sparkles, ArrowRight, Play, CheckCircle2, Trash2, 
  Loader2, AlertCircle, Download, Library, Plus, ChevronLeft, BookOpen,
  Music, Mic, Type as TypeIcon, Clock, Move, Copy, GripVertical, Eye, Zap,
  X, Layers, Wand2
} from 'lucide-react';
import { ComicPage, ComicStory, StoryScene, VideoProject, MotionType, ActionFxType } from './types';
import { geminiService } from './services/geminiService';
import { storageService } from './services/storageService';
import JSZip from 'jszip';

const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
const MUSIC_TRACKS: Record<string, string> = {
  'Без музыки': '',
  'Эпичный экшен': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'Детектив': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'Киберпанк': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3'
};
const FX_LIST: ActionFxType[] = ['NONE', 'POW', 'BOOM', 'CRASH', 'ZAP', 'BANG'];

// Встроенный код воркера для предотвращения ошибок загрузки внешнего файла
const WORKER_CODE = `
let canvas;
let ctx;

self.onmessage = async (e) => {
  const { type, data } = e.data;

  if (type === 'init') {
    canvas = e.data.canvas;
    ctx = canvas.getContext('2d', { alpha: false });
    return;
  }

  if (type === 'render_scene') {
    renderFrame(data);
    self.postMessage({ type: 'frame_done' });
  }
};

function renderFrame(data) {
  const { scene, imageBitmap, t, words, showSubtitles } = data;
  const { width, height } = canvas;

  // 1. Отрисовка размытого фона
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
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 50;
  ctx.drawImage(imageBitmap, sourceX, sourceY, sourceW, sourceH, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // 3. Action FX
  if (scene.actionFx && scene.actionFx !== 'NONE' && t > 0.2 && t < 0.8) {
    const fxT = (t - 0.2) / 0.6;
    const fxScale = 1.0 + Math.sin(fxT * Math.PI) * 0.2;
    const shake = Math.sin(fxT * 20) * 5;

    ctx.save();
    ctx.font = 'italic bold 140px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(width / 2 + shake, height / 3);
    ctx.scale(fxScale, fxScale);
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

  // 4. Субтитры
  if (showSubtitles) {
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    const activeWordIdx = Math.floor(t * words.length);
    const lineY = height - 180;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(50, lineY - 60, width - 100, 100);
    const fullText = words.join(" ");
    const metrics = ctx.measureText(fullText);
    let currentX = (width - metrics.width) / 2;
    words.forEach((word, idx) => {
      const isHighlight = idx <= activeWordIdx;
      ctx.fillStyle = isHighlight ? '#fde047' : 'white';
      const wordMetrics = ctx.measureText(word + " ");
      ctx.fillText(word, currentX + wordMetrics.width / 2, lineY);
      currentX += wordMetrics.width;
    });
  }
}
`;

function getPossibleMimeTypes() {
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4'
  ];
}

export default function App() {
  const [view, setView] = useState<'library' | 'editor'>('library');
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);
  const [step, setStep] = useState(1);
  const [pages, setPages] = useState<ComicPage[]>([]);
  const [stories, setStories] = useState<ComicStory[]>([]);
  const [selectedStory, setSelectedStory] = useState<ComicStory | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [renderJob, setRenderJob] = useState<{
    status: 'idle' | 'rendering' | 'completed';
    progress: number;
    title: string;
    videoUrl?: string;
  }>({ status: 'idle', progress: 0, title: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const canvasTransferred = useRef(false);

  useEffect(() => {
    storageService.getAllProjects().then(setProjects);
    
    try {
      const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      workerRef.current = new Worker(workerUrl);
    } catch (e) {
      console.error("Критическая ошибка Worker:", e);
      setError("Система рендеринга не запустилась. Проверьте настройки безопасности браузера.");
    }
    
    return () => workerRef.current?.terminate();
  }, []);

  const createNewProject = () => {
    setCurrentProject(null); setPages([]); setStories([]); setSelectedStory(null);
    setStep(1); setView('editor'); setFinalVideoUrl(null);
  };

  const loadProject = (project: VideoProject) => {
    setCurrentProject(project); setPages(project.pages); setStories(project.stories);
    setStep(2); setView('editor'); setFinalVideoUrl(null);
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Удалить проект навсегда?')) {
      await storageService.deleteProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.name.endsWith('.cbr') || file.name.endsWith('.cbz') || file.name.endsWith('.zip')) {
        try {
          const zip = new JSZip();
          const content = await zip.loadAsync(file);
          const entries = Object.values(content.files).filter(f => !f.dir && /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
          for (const entry of entries) {
            const blob = await entry.async('blob');
            const base64 = await new Promise<string>((resolve) => {
              const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(blob);
            });
            setPages(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), url: URL.createObjectURL(blob), name: entry.name, base64 }]);
          }
        } catch (err) { setError("Ошибка архива"); }
      } else if (file.type.startsWith('image/')) {
        const r = new FileReader();
        r.onload = () => setPages(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), url: URL.createObjectURL(file), name: file.name, base64: r.result as string }]);
        r.readAsDataURL(file);
      }
    }
  };

  const startAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const results = await geminiService.analyzeComic(pages);
      const newProject: VideoProject = {
        id: currentProject?.id || Math.random().toString(36).substr(2, 9),
        comicTitle: pages[0]?.name.split('.')[0] || "Новый комикс",
        pages, stories: results
      };
      await storageService.saveProject(newProject);
      setProjects(await storageService.getAllProjects());
      setCurrentProject(newProject);
      setStories(results);
      setStep(2);
    } catch (err) { 
      console.error(err);
      setError("ИИ временно недоступен. Попробуйте позже."); 
    }
    finally { setIsAnalyzing(false); }
  };

  const previewScene = async (scene: StoryScene) => {
    if (!editorCanvasRef.current || !selectedStory) return;
    const canvas = editorCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const page = pages.find(p => p.id === scene.imageReferenceId);
    if (!page) return;

    const img = new Image(); img.src = page.url;
    await new Promise(res => img.onload = res);

    try {
      const voiceBuffer = await geminiService.generateVoiceover(scene.voiceoverText, scene.voiceName || selectedStory.voiceName);
      const audioCtx = new AudioContext();
      const source = audioCtx.createBufferSource();
      source.buffer = voiceBuffer;
      source.connect(audioCtx.destination);
      source.start();

      const startTime = performance.now();
      const durationMs = scene.duration * 1000;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        ctx.fillStyle = '#000'; ctx.fillRect(0,0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
        if (t < 1) requestAnimationFrame(animate);
        else audioCtx.close();
      };
      requestAnimationFrame(animate);
    } catch (err) {
      console.error("Preview failed", err);
    }
  };

  const assembleVideoBackground = async () => {
    if (!selectedStory || !hiddenCanvasRef.current || !workerRef.current) return;
    
    setRenderJob({ status: 'rendering', progress: 0, title: selectedStory.title });

    const canvas = hiddenCanvasRef.current;
    const worker = workerRef.current;

    if (!canvasTransferred.current) {
      try {
        const offscreen = canvas.transferControlToOffscreen();
        worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
        canvasTransferred.current = true;
      } catch (e) {
        console.warn("Canvas уже передан воркеру");
      }
    }

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const audioDestination = audioCtx.createMediaStreamDestination();
    
    // Пытаемся загрузить музыку, но не блокируем рендеринг при ошибке
    if (selectedStory.musicMood !== 'Без музыки' && MUSIC_TRACKS[selectedStory.musicMood]) {
      try {
        const musicResp = await fetch(MUSIC_TRACKS[selectedStory.musicMood]);
        if (musicResp.ok) {
          const arrayBuffer = await musicResp.arrayBuffer();
          const musicBuf = await audioCtx.decodeAudioData(arrayBuffer);
          const musicSource = audioCtx.createBufferSource();
          musicSource.buffer = musicBuf; musicSource.loop = true;
          const musicGain = audioCtx.createGain(); musicGain.gain.value = 0.08;
          musicSource.connect(musicGain); musicGain.connect(audioDestination);
          musicSource.start();
        }
      } catch (e) { 
        console.warn("Музыка не была загружена:", e.message);
      }
    }

    const videoStream = canvas.captureStream(30);
    const combined = new MediaStream([...videoStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    
    let recorder: MediaRecorder | null = null;
    const mimeTypes = getPossibleMimeTypes();
    
    // Пытаемся инициализировать MediaRecorder с доступными форматами
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        try {
          recorder = new MediaRecorder(combined, { 
            mimeType: type, 
            videoBitsPerSecond: 8000000 
          });
          break; // Успешно создан
        } catch (e) {
          console.warn(`Тип ${type} не удалось инициализировать, пробуем следующий...`, e);
        }
      }
    }

    if (!recorder) {
      setError("Ваш браузер не поддерживает доступные форматы видео-записи.");
      setRenderJob({ status: 'idle', progress: 0, title: '' });
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const finalBlob = new Blob(chunks, { type: chunks[0]?.type || 'video/mp4' });
      const url = URL.createObjectURL(finalBlob);
      setRenderJob(prev => ({ ...prev, status: 'completed', progress: 100, videoUrl: url }));
      audioCtx.close();
    };
    recorder.start();

    try {
      for (let i = 0; i < selectedStory.storyboard.length; i++) {
        const scene = selectedStory.storyboard[i];
        const page = pages.find(p => p.id === scene.imageReferenceId);
        if (!page) continue;

        const imgBlob = await fetch(page.url).then(r => r.blob());
        const imageBitmap = await createImageBitmap(imgBlob);

        try {
          const voiceBuffer = await geminiService.generateVoiceover(scene.voiceoverText, scene.voiceName || selectedStory.voiceName);
          const source = audioCtx.createBufferSource();
          source.buffer = voiceBuffer;
          source.connect(audioDestination);
          source.start();
        } catch (vErr) {
          console.error("Озвучка не удалась для сцены", i, vErr);
        }

        const totalFrames = 30 * scene.duration;
        const words = scene.voiceoverText.split(/\s+/);

        for (let f = 0; f < totalFrames; f++) {
          worker.postMessage({
            type: 'render_scene',
            data: { scene, imageBitmap, t: f / totalFrames, words, showSubtitles: selectedStory.showSubtitles }
          });
          
          await new Promise(resolve => {
            const handler = (e: any) => {
              if (e.data.type === 'frame_done') {
                worker.removeEventListener('message', handler);
                resolve(null);
              }
            };
            worker.addEventListener('message', handler);
          });
          
          setRenderJob(prev => ({ ...prev, progress: Math.round(((i + (f/totalFrames)) / selectedStory.storyboard.length) * 100) }));
        }
        imageBitmap.close();
      }
      recorder.stop();
    } catch (err) {
      console.error("Ошибка процесса рендеринга", err);
      setRenderJob({ status: 'idle', progress: 0, title: '' });
      if (recorder.state !== 'inactive') recorder.stop();
    }
  };

  return (
    <div className="min-h-screen p-8 bg-[#09090b] text-white flex flex-col items-center overflow-x-hidden">
      <canvas ref={hiddenCanvasRef} width={720} height={1280} className="fixed -left-[2000px] pointer-events-none" />

      {renderJob.status !== 'idle' && (
        <div className="fixed bottom-8 right-8 w-80 bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-3xl z-50 animate-in slide-in-from-right-10 duration-500 backdrop-blur-xl">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-600/20 p-2 rounded-lg"><Layers size={16} className="text-indigo-500" /></div>
              <h4 className="text-xs font-black uppercase tracking-widest italic">Рендеринг</h4>
            </div>
            {renderJob.status === 'completed' && (
              <button onClick={() => setRenderJob({ status: 'idle', progress: 0, title: '' })} className="text-zinc-500 hover:text-white"><X size={16}/></button>
            )}
          </div>
          <p className="text-sm font-bold text-zinc-300 mb-4 truncate italic">{renderJob.title}</p>
          {renderJob.status === 'rendering' ? (
            <div className="space-y-3">
              <div className="flex justify-between items-end">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest animate-pulse">Сборка кадров...</span>
                <span className="text-xs font-mono font-black">{renderJob.progress}%</span>
              </div>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${renderJob.progress}%` }} />
              </div>
            </div>
          ) : (
            <button onClick={() => { if (renderJob.videoUrl) { setFinalVideoUrl(renderJob.videoUrl); setStep(4); setRenderJob({ status: 'idle', progress: 0, title: '' }); } }} className="w-full bg-indigo-600 hover:bg-indigo-500 py-3 rounded-2xl text-xs font-black uppercase italic shadow-lg shadow-indigo-600/20">Посмотреть результат</button>
          )}
        </div>
      )}

      {error && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500/50 p-6 rounded-3xl flex items-center gap-4 z-[100] animate-in fade-in slide-in-from-top-10 backdrop-blur-md">
          <AlertCircle className="text-red-500" />
          <span className="text-sm font-bold">{error}</span>
          <button onClick={() => setError(null)}><X size={16}/></button>
        </div>
      )}

      <header className="w-full max-w-6xl flex justify-between items-center mb-10">
        <button onClick={() => setView('library')} className="text-zinc-500 hover:text-white flex items-center gap-2 font-bold transition-colors uppercase text-sm tracking-widest">
          <ChevronLeft /> К БИБЛИОТЕКЕ
        </button>
        <h1 className="text-2xl font-comic text-indigo-400 uppercase tracking-widest italic">
          {currentProject?.comicTitle || "ComixReel AI"}
        </h1>
        <div className="flex items-center gap-4">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest italic">Статус: Готов</span>
        </div>
      </header>

      {view === 'library' ? (
        <main className="w-full max-w-6xl animate-in fade-in duration-500">
          <header className="flex justify-between items-center mb-16">
            <h2 className="text-5xl font-black uppercase italic tracking-wider">Мои Reels</h2>
            <button onClick={createNewProject} className="bg-indigo-600 hover:bg-indigo-500 px-10 py-5 rounded-[2rem] font-black flex items-center gap-3 transition-all active:scale-95 shadow-xl shadow-indigo-600/30">
              <Plus size={24} /> Новый проект
            </button>
          </header>
          {projects.length === 0 ? (
            <div className="py-40 bg-zinc-900/20 border-2 border-dashed border-zinc-800 rounded-[5rem] flex flex-col items-center">
              <BookOpen size={100} className="text-zinc-800 mb-8" />
              <p className="text-zinc-500 text-2xl font-black uppercase italic tracking-widest">Проектов нет</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
              {projects.map(p => (
                <div key={p.id} onClick={() => loadProject(p)} className="bg-zinc-900 border border-zinc-800 rounded-[3.5rem] overflow-hidden hover:border-indigo-600/50 transition-all cursor-pointer group shadow-2xl relative">
                  <div className="aspect-[4/3] relative overflow-hidden">
                    <img src={p.pages[0]?.url} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000 opacity-50" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                    <div className="absolute bottom-10 left-10 right-10">
                      <h3 className="text-3xl font-black mb-1 uppercase italic tracking-tight">{p.comicTitle}</h3>
                      <p className="text-zinc-500 text-[11px] font-mono font-bold uppercase tracking-[0.2em]">{p.pages.length} СТР &bull; {p.stories.length} СЮЖЕТОВ</p>
                    </div>
                  </div>
                  <button onClick={(e) => deleteProject(p.id, e)} className="absolute top-8 right-8 p-4 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-2xl transition-all opacity-0 group-hover:opacity-100"><Trash2 size={20}/></button>
                </div>
              ))}
            </div>
          )}
        </main>
      ) : (
        <main className="w-full max-w-7xl animate-in fade-in duration-500">
          <div className="flex items-center justify-center gap-6 mb-16">
            {[1,2,3,4].map(s => (
              <div key={s} className="flex items-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-lg ${step >= s ? 'bg-indigo-600 shadow-[0_0_30px_#4f46e5]' : 'bg-zinc-800 text-zinc-500'}`}>{step > s ? <CheckCircle2 size={24}/> : s}</div>
                {s < 4 && <div className={`w-20 h-0.5 mx-4 ${step > s ? 'bg-indigo-600 shadow-[0_0_10px_#4f46e5]' : 'bg-zinc-800'}`} />}
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-16 animate-in slide-in-from-bottom-10">
               <div onClick={() => fileInputRef.current?.click()} className="border-4 border-dashed border-zinc-800 rounded-[6rem] py-36 bg-zinc-900/10 hover:bg-zinc-900/30 hover:border-indigo-600/50 transition-all cursor-pointer flex flex-col items-center group shadow-3xl">
                <div className="bg-indigo-600/10 p-12 rounded-full mb-10 group-hover:scale-110 transition-transform shadow-inner ring-1 ring-indigo-500/20"><Upload size={100} className="text-indigo-500" /></div>
                <h2 className="text-4xl font-black text-zinc-300 uppercase italic tracking-[0.2em]">Загрузить комикс</h2>
                <p className="text-zinc-600 mt-5 font-mono text-sm uppercase tracking-widest italic">CBR, CBZ, ZIP или JPEG</p>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} accept=".cbr,.cbz,.zip,image/*" />
              </div>
              {pages.length > 0 && (
                <div className="bg-zinc-900/40 p-14 rounded-[5rem] border border-zinc-800 backdrop-blur-md shadow-3xl">
                  <div className="flex justify-between items-center mb-14">
                    <h3 className="text-4xl font-black italic uppercase text-indigo-400">{pages.length} ресурсов загружено</h3>
                    <button onClick={startAnalysis} disabled={isAnalyzing} className="bg-indigo-600 hover:bg-indigo-500 px-16 py-7 rounded-[3rem] font-black text-2xl flex items-center gap-4 transition-all shadow-3xl active:scale-95 disabled:opacity-50 border-b-4 border-indigo-800">
                      {isAnalyzing ? <Loader2 className="animate-spin" size={32} /> : <Wand2 size={32} />}
                      {isAnalyzing ? 'Анализ...' : 'Запустить ИИ'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-8">
                    {pages.map((p, idx) => (
                      <div key={p.id} className="aspect-[3/4] rounded-3xl overflow-hidden border-2 border-zinc-800 relative shadow-2xl hover:scale-105 transition-all group hover:border-indigo-500/50">
                        <img src={p.url} className="w-full h-full object-cover" />
                        <div className="absolute top-4 left-4 bg-indigo-600 text-[11px] px-3 py-1.5 rounded-xl font-black shadow-2xl">#{idx + 1}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-6xl mx-auto animate-in fade-in duration-700">
              {stories.map(s => (
                <div key={s.id} onClick={() => { setSelectedStory(s); setStep(3); }} className="bg-zinc-900/60 border border-zinc-800 p-14 rounded-[5rem] hover:border-indigo-600 transition-all cursor-pointer group shadow-3xl relative overflow-hidden backdrop-blur-xl border-b-8 border-zinc-800 hover:border-b-indigo-800">
                  <h3 className="text-5xl font-black mb-10 text-indigo-400 italic uppercase leading-none tracking-tighter">{s.title}</h3>
                  <p className="text-zinc-400 leading-relaxed mb-14 text-2xl font-medium line-clamp-4">{s.summary}</p>
                  <div className="flex items-center gap-5 text-white font-black bg-zinc-800 group-hover:bg-indigo-600 px-14 py-6 rounded-[2.5rem] w-fit transition-all uppercase italic shadow-2xl tracking-widest text-lg">Выбрать сценарий <ArrowRight size={28}/></div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && selectedStory && (
            <div className="flex flex-col lg:flex-row gap-14 animate-in fade-in duration-700">
              <div className="flex-1 space-y-12">
                <div className="bg-zinc-900/40 p-12 rounded-[5rem] border border-zinc-800 grid grid-cols-1 md:grid-cols-3 gap-12 backdrop-blur-md shadow-3xl border-b-8 border-zinc-800">
                  <div className="space-y-5">
                    <label className="text-[11px] font-black text-zinc-500 flex items-center gap-3 uppercase tracking-[0.3em] italic"><Mic size={20} className="text-indigo-500" /> Голос</label>
                    <select className="w-full bg-zinc-800/60 border border-zinc-700 p-6 rounded-[2.5rem] outline-none font-bold text-zinc-200 text-lg" value={selectedStory.voiceName} onChange={e => setSelectedStory({...selectedStory, voiceName: e.target.value})}>
                      {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="space-y-5">
                    <label className="text-[11px] font-black text-zinc-500 flex items-center gap-3 uppercase tracking-[0.3em] italic"><Music size={20} className="text-indigo-500" /> Музыка</label>
                    <select className="w-full bg-zinc-800/60 border border-zinc-700 p-6 rounded-[2.5rem] outline-none font-bold text-zinc-200 text-lg" value={selectedStory.musicMood} onChange={e => setSelectedStory({...selectedStory, musicMood: e.target.value})}>
                      {Object.keys(MUSIC_TRACKS).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col justify-end">
                    <button onClick={() => setSelectedStory({...selectedStory, showSubtitles: !selectedStory.showSubtitles})} className={`w-full p-6 rounded-[2.5rem] font-black transition-all flex items-center justify-center gap-4 shadow-2xl uppercase italic text-lg ${selectedStory.showSubtitles ? 'bg-indigo-600 text-white shadow-indigo-600/30' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
                      <TypeIcon size={24}/> Субтитры: {selectedStory.showSubtitles ? 'ВКЛ' : 'ВЫКЛ'}
                    </button>
                  </div>
                </div>
                <div className="space-y-12 max-h-[75vh] overflow-y-auto pr-10 custom-scrollbar pb-20">
                  {selectedStory.storyboard.map((scene, idx) => (
                    <div key={scene.id} className="group bg-zinc-900/60 border-2 border-zinc-800 p-12 rounded-[5rem] flex flex-col md:flex-row gap-14 shadow-3xl hover:bg-zinc-900/90 transition-all relative border-b-8 hover:border-indigo-600/50">
                      <div className="flex flex-col items-center gap-8">
                         <div className="w-56 h-72 bg-zinc-800 rounded-[3rem] overflow-hidden flex-shrink-0 border-4 border-zinc-700 relative shadow-2xl group-hover:border-indigo-500/50 transition-all">
                          <img src={pages.find(p => p.id === scene.imageReferenceId)?.url} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-6 transition-all backdrop-blur-md">
                             <button onClick={() => previewScene(scene)} className="bg-indigo-600 p-6 rounded-[2rem] text-white shadow-3xl active:scale-90 transform group-hover:scale-110"><Eye size={40} /></button>
                             <button onClick={() => { const upd = [...selectedStory.storyboard]; upd.splice(idx+1,0,{...scene, id: Math.random().toString()}); setSelectedStory({...selectedStory, storyboard: upd}); }} className="bg-zinc-800/80 p-5 rounded-3xl text-zinc-300 hover:text-white transition-all active:scale-90"><Copy size={28}/></button>
                          </div>
                        </div>
                        <div className="px-5 py-2 bg-zinc-800 rounded-2xl text-[10px] font-black text-zinc-500 uppercase italic tracking-[0.4em]">Сцена {idx+1}</div>
                      </div>
                      <div className="flex-1 flex flex-col gap-10">
                        <textarea className="w-full bg-zinc-800/20 border-2 border-zinc-800 rounded-[3.5rem] p-12 text-2xl outline-none focus:border-indigo-600 transition-all font-medium text-zinc-200 resize-none min-h-[180px] shadow-inner leading-relaxed" value={scene.voiceoverText} onChange={e => { const upd = [...selectedStory.storyboard]; upd[idx].voiceoverText = e.target.value; setSelectedStory({...selectedStory, storyboard: upd}); }} />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
                          <div className="bg-zinc-800/30 p-8 rounded-[3rem] border border-zinc-800 flex flex-col gap-4 shadow-inner">
                             <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] italic">Камера</label>
                             <select className="bg-transparent text-lg font-black text-indigo-400 outline-none uppercase italic appearance-none" value={scene.motionType} onChange={e => { const upd = [...selectedStory.storyboard]; upd[idx].motionType = e.target.value as MotionType; setSelectedStory({...selectedStory, storyboard: upd}); }}>
                                <option value="SMART_FOCUS">Фокус</option>
                                <option value="ZOOM_IN">Наезд</option>
                                <option value="ZOOM_OUT">Отъезд</option>
                                <option value="PAN_LEFT">Влево</option>
                                <option value="PAN_RIGHT">Вправо</option>
                             </select>
                          </div>
                          <div className="bg-zinc-800/30 p-8 rounded-[3rem] border border-zinc-800 flex flex-col gap-4 shadow-inner">
                             <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] italic">FX</label>
                             <select className="bg-transparent text-lg font-black text-amber-500 outline-none uppercase italic appearance-none" value={scene.actionFx} onChange={e => { const upd = [...selectedStory.storyboard]; upd[idx].actionFx = e.target.value as ActionFxType; setSelectedStory({...selectedStory, storyboard: upd}); }}>
                                {FX_LIST.map(f => <option key={f} value={f}>{f}</option>)}
                             </select>
                          </div>
                          <div className="bg-zinc-800/30 p-8 rounded-[3rem] border border-zinc-800 flex flex-col gap-4 shadow-inner">
                             <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] italic">Сек</label>
                             <input type="number" step="0.5" className="bg-transparent text-2xl font-black text-zinc-100 outline-none" value={scene.duration} onChange={e => { const upd = [...selectedStory.storyboard]; upd[idx].duration = parseFloat(e.target.value); setSelectedStory({...selectedStory, storyboard: upd}); }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lg:w-[500px]">
                <div className="sticky top-10 bg-zinc-900 p-14 rounded-[6rem] border-[18px] border-zinc-800 shadow-3xl flex flex-col items-center ring-1 ring-white/10">
                  <div className="aspect-[9/16] w-full bg-black rounded-[4rem] mb-14 overflow-hidden relative shadow-inner group">
                    <canvas ref={editorCanvasRef} width={720} height={1280} className="w-full h-full object-contain" />
                  </div>
                  <button onClick={assembleVideoBackground} disabled={renderJob.status === 'rendering'} className="w-full bg-indigo-600 hover:bg-indigo-500 py-12 rounded-[3.5rem] font-black text-4xl flex items-center justify-center gap-6 transition-all shadow-3xl active:scale-95 uppercase italic tracking-widest disabled:opacity-50 border-b-8 border-indigo-900">
                    <Zap size={48} fill="currentColor" /> {renderJob.status === 'rendering' ? 'Сборка...' : 'Собрать Reels'}
                  </button>
                  <p className="mt-10 text-zinc-500 text-[10px] font-bold uppercase tracking-[0.4em] text-center italic opacity-50">1080p &bull; 30FPS &bull; Фоновый поток</p>
                </div>
              </div>
            </div>
          )}

          {step === 4 && finalVideoUrl && (
            <div className="animate-in zoom-in-95 duration-1000 flex flex-col items-center py-10">
              <h2 className="text-8xl font-comic mb-24 text-white italic tracking-widest text-center drop-shadow-[0_0_50px_rgba(79,70,229,0.5)]">Готово!</h2>
              <div className="max-w-[480px] aspect-[9/16] bg-black rounded-[6.5rem] border-[22px] border-zinc-800 overflow-hidden shadow-[0_0_200px_rgba(79,70,229,0.3)] mb-24 relative ring-1 ring-white/10">
                <video src={finalVideoUrl} controls autoPlay loop className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col sm:flex-row gap-12">
                <a href={finalVideoUrl} download={`${selectedStory?.title || 'comic-reel'}.mp4`} className="bg-indigo-600 hover:bg-indigo-500 px-28 py-12 rounded-[4.5rem] font-black text-4xl flex items-center gap-7 transition-all active:scale-95 shadow-3xl uppercase italic tracking-widest border-b-8 border-indigo-900">
                  <Download size={48} /> Скачать MP4
                </a>
                <button onClick={() => setView('library')} className="bg-zinc-800 hover:bg-zinc-700 px-28 py-12 rounded-[4.5rem] font-black text-4xl transition-all uppercase italic tracking-widest shadow-2xl border border-zinc-700 active:scale-95">В библиотеку</button>
              </div>
            </div>
          )}
        </main>
      )}
      <footer className="mt-48 mb-16 opacity-10 font-black tracking-[3em] text-[11px] uppercase text-zinc-400 italic pointer-events-none select-none">ComixReel AI Engine &bull; v2.2</footer>
    </div>
  );
}
