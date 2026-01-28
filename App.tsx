
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
  ctx.save();
  ctx.filter = 'blur(30px) brightness(0.4)';
  ctx.drawImage(imageBitmap, -width, -height, width * 3, height * 3);
  ctx.restore();

  const box = scene.panelBox || { x: 0, y: 0, width: 100, height: 100 };
  const sX = (box.x / 100) * imageBitmap.width;
  const sY = (box.y / 100) * imageBitmap.height;
  const sW = (box.width / 100) * imageBitmap.width;
  const sH = (box.height / 100) * imageBitmap.height;

  let scale = 1.0, oX = 0, oY = 0;
  if (scene.motionType === 'ZOOM_IN') scale = 1.0 + t * 0.3;
  else if (scene.motionType === 'ZOOM_OUT') scale = 1.3 - t * 0.3;
  else if (scene.motionType === 'PAN_LEFT') oX = -t * 100;
  else if (scene.motionType === 'PAN_RIGHT') oX = t * 100;

  const imgAspect = sW / sH;
  const canvasAspect = width / height;
  let dW, dH;
  if (imgAspect > canvasAspect) { dW = width * scale; dH = dW / imgAspect; }
  else { dH = height * scale; dW = dH * imgAspect; }

  ctx.save();
  ctx.translate(width / 2 + oX, height / 2 + oY);
  ctx.shadowColor = 'black'; ctx.shadowBlur = 30;
  ctx.drawImage(imageBitmap, sX, sY, sW, sH, -dW / 2, -dH / 2, dW, dH);
  ctx.restore();

  if (scene.actionFx && scene.actionFx !== 'NONE' && t > 0.2 && t < 0.8) {
    ctx.save();
    ctx.font = 'bold 100px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fde047';
    ctx.strokeStyle = 'black'; ctx.lineWidth = 8;
    ctx.strokeText(scene.actionFx, width/2, height/3);
    ctx.fillText(scene.actionFx, width/2, height/3);
    ctx.restore();
  }

  if (showSubtitles) {
    ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'white';
    ctx.fillText(words.join(" "), width/2, height - 150);
  }
}
`;

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
      workerRef.current = new Worker(URL.createObjectURL(blob));
    } catch (e) { setError("Ошибка инициализации графического ядра."); }
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
    if (confirm('Удалить проект?')) {
      await storageService.deleteProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.name.match(/\.(cbr|cbz|zip)$/i)) {
        try {
          const zip = new JSZip();
          const content = await zip.loadAsync(file);
          const entries = Object.values(content.files).filter(f => !f.dir && /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
          for (const entry of entries) {
            const blob = await entry.async('blob');
            const base64 = await new Promise<string>((res) => {
              const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob);
            });
            setPages(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), url: URL.createObjectURL(blob), name: entry.name, base64 }]);
          }
        } catch (err) { setError("Ошибка при чтении архива."); }
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
    } catch (err) { setError("ИИ не смог проанализировать комикс. Попробуйте еще раз."); }
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

      const start = performance.now();
      const dur = scene.duration * 1000;
      const anim = (now: number) => {
        const t = Math.min((now - start) / dur, 1);
        ctx.fillStyle = '#000'; ctx.fillRect(0,0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
        if (t < 1) requestAnimationFrame(anim);
        else audioCtx.close();
      };
      requestAnimationFrame(anim);
    } catch (e) { console.error(e); }
  };

  const assembleVideo = async () => {
    if (!selectedStory || !hiddenCanvasRef.current || !workerRef.current) return;
    setRenderJob({ status: 'rendering', progress: 0, title: selectedStory.title });
    const canvas = hiddenCanvasRef.current;
    const worker = workerRef.current;

    if (!canvasTransferred.current) {
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: off }, [off]);
      canvasTransferred.current = true;
    }

    const audioCtx = new AudioContext({ sampleRate: 24000 });
    const dest = audioCtx.createMediaStreamDestination();
    
    const vStream = canvas.captureStream(30);
    const combined = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    
    let recorder: MediaRecorder | null = null;
    const types = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) {
        recorder = new MediaRecorder(combined, { mimeType: t, videoBitsPerSecond: 5000000 });
        break;
      }
    }

    if (!recorder) return setError("Запись видео не поддерживается в этом браузере.");
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: chunks[0]?.type }));
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
        const bitmap = await createImageBitmap(imgBlob);

        try {
          const vBuf = await geminiService.generateVoiceover(scene.voiceoverText, scene.voiceName || selectedStory.voiceName);
          const src = audioCtx.createBufferSource();
          src.buffer = vBuf; src.connect(dest); src.start();
        } catch (e) {}

        const frames = 30 * scene.duration;
        for (let f = 0; f < frames; f++) {
          worker.postMessage({ type: 'render_scene', data: { scene, imageBitmap: bitmap, t: f/frames, words: scene.voiceoverText.split(' '), showSubtitles: selectedStory.showSubtitles } });
          await new Promise(r => {
            const h = (e: any) => { if (e.data.type === 'frame_done') { worker.removeEventListener('message', h); r(null); } };
            worker.addEventListener('message', h);
          });
          setRenderJob(prev => ({ ...prev, progress: Math.round(((i + (f/frames)) / selectedStory.storyboard.length) * 100) }));
        }
        bitmap.close();
      }
      recorder.stop();
    } catch (e) { setRenderJob({ status: 'idle', progress: 0, title: '' }); recorder.stop(); }
  };

  return (
    <div className="container-fluid p-0">
      <canvas ref={hiddenCanvasRef} width={720} height={1280} className="d-none" />

      {/* Task Manager Overlay */}
      {renderJob.status !== 'idle' && (
        <div className="card floating-renderer border-primary">
          <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
            <small className="fw-bold text-uppercase"><Layers size={14} className="me-2"/> Рендеринг</small>
            {renderJob.status === 'completed' && <button onClick={() => setRenderJob({ status: 'idle', progress: 0, title: '' })} className="btn-close btn-close-white"></button>}
          </div>
          <div className="card-body p-3">
            <p className="small fw-bold mb-2 text-truncate">{renderJob.title}</p>
            {renderJob.status === 'rendering' ? (
              <div className="progress" style={{ height: '8px' }}>
                <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${renderJob.progress}%` }}></div>
              </div>
            ) : (
              <button onClick={() => { if (renderJob.videoUrl) { setFinalVideoUrl(renderJob.videoUrl); setStep(4); setRenderJob({ status: 'idle', progress: 0, title: '' }); } }} className="btn btn-sm btn-success w-100">Посмотреть результат</button>
            )}
          </div>
        </div>
      )}

      {/* App Header */}
      <header className="app-header">
        <div className="container d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center">
            {view === 'editor' && (
              <button onClick={() => setView('library')} className="btn btn-link text-muted me-3 p-0">
                <ChevronLeft />
              </button>
            )}
            <h1 className="h4 mb-0 font-comic text-primary">ComixReel AI</h1>
          </div>
          <div className="d-flex align-items-center gap-3">
            <span className="badge bg-light text-success border border-success border-opacity-25 px-3 py-2">
              <span className="d-inline-block bg-success rounded-circle me-2" style={{width: '8px', height: '8px'}}></span>
              Система активна
            </span>
          </div>
        </div>
      </header>

      {view === 'library' ? (
        <main className="container pb-5">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2 className="h3 fw-bold mb-0">Мои проекты</h2>
            <button onClick={createNewProject} className="btn btn-primary d-flex align-items-center gap-2 px-4 py-2 shadow-sm">
              <Plus size={18} /> Создать новый
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-5 bg-white rounded-4 border">
              <BookOpen size={64} className="text-muted mb-3 opacity-25" />
              <p className="text-muted mb-0">У вас пока нет созданных проектов.</p>
            </div>
          ) : (
            <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4">
              {projects.map(p => (
                <div key={p.id} className="col">
                  <div className="card h-100 overflow-hidden border-0" onClick={() => loadProject(p)} style={{cursor: 'pointer'}}>
                    <div className="position-relative" style={{aspectRatio: '16/9'}}>
                      <img src={p.pages[0]?.url} className="w-100 h-100 object-fit-cover opacity-75" alt={p.comicTitle} />
                      <div className="position-absolute bottom-0 start-0 p-3 w-100 bg-dark bg-opacity-50 text-white">
                        <h5 className="mb-0 text-truncate">{p.comicTitle}</h5>
                      </div>
                    </div>
                    <div className="card-body bg-white border-top d-flex justify-content-between align-items-center">
                      <small className="text-muted text-uppercase fw-bold ls-1" style={{fontSize: '0.7rem'}}>
                        {p.pages.length} стр &bull; {p.stories.length} сюжета
                      </small>
                      <button onClick={(e) => deleteProject(p.id, e)} className="btn btn-link text-danger p-0">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      ) : (
        <main className="container pb-5">
          {/* Neutral Stepper */}
          <div className="step-indicator">
            <div className={`step-dot ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>1</div>
            <div className={`step-line ${step > 1 ? 'active' : ''}`}></div>
            <div className={`step-dot ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>2</div>
            <div className={`step-line ${step > 2 ? 'active' : ''}`}></div>
            <div className={`step-dot ${step >= 3 ? 'active' : ''} ${step > 3 ? 'completed' : ''}`}>3</div>
            <div className={`step-line ${step > 3 ? 'active' : ''}`}></div>
            <div className={`step-dot ${step >= 4 ? 'active' : ''}`}>4</div>
          </div>

          {error && (
            <div className="alert alert-danger alert-dismissible fade show rounded-3 mb-4 d-flex align-items-center" role="alert">
              <AlertCircle className="me-3" />
              <div>{error}</div>
              <button type="button" className="btn-close" onClick={() => setError(null)}></button>
            </div>
          )}

          {step === 1 && (
            <div className="mx-auto" style={{maxWidth: '800px'}}>
              <div className="dropzone mb-4" onClick={() => fileInputRef.current?.click()}>
                <div className="mb-3"><Upload size={48} className="text-primary opacity-50" /></div>
                <h4 className="fw-bold">Загрузите файлы комикса</h4>
                <p className="text-muted small">CBR, CBZ, ZIP или набор изображений</p>
                <input ref={fileInputRef} type="file" multiple className="d-none" onChange={handleFileUpload} accept=".cbr,.cbz,.zip,image/*" />
              </div>

              {pages.length > 0 && (
                <div className="card p-4">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5 className="mb-0 fw-bold">{pages.length} страниц загружено</h5>
                    <button onClick={startAnalysis} disabled={isAnalyzing} className="btn btn-primary px-4">
                      {isAnalyzing ? <><Loader2 size={18} className="spinner-border spinner-border-sm me-2"/> Анализ...</> : <><Wand2 size={18} className="me-2"/> Анализировать ИИ</>}
                    </button>
                  </div>
                  <div className="row g-2 overflow-auto custom-scrollbar" style={{maxHeight: '300px'}}>
                    {pages.map((p, i) => (
                      <div key={p.id} className="col-2">
                        <img src={p.url} className="img-thumbnail rounded-3 w-100" style={{aspectRatio: '3/4', objectFit: 'cover'}} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="row g-4 justify-content-center">
              <div className="col-12 text-center mb-3">
                <h4 className="fw-bold">Выберите сюжет для генерации</h4>
              </div>
              {stories.map(s => (
                <div key={s.id} className="col-md-5">
                  <div className="card h-100 p-4" onClick={() => { setSelectedStory(s); setStep(3); }} style={{cursor: 'pointer'}}>
                    <h5 className="fw-bold text-primary mb-3">{s.title}</h5>
                    <p className="text-muted small mb-4">{s.summary}</p>
                    <button className="btn btn-outline-primary mt-auto d-flex align-items-center justify-content-center gap-2">
                      Перейти к редактору <ArrowRight size={16}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && selectedStory && (
            <div className="row">
              <div className="col-lg-8">
                <div className="card p-4 mb-4 bg-light border-0">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-bold text-muted">Голос диктора</label>
                      <select className="form-select form-select-sm" value={selectedStory.voiceName} onChange={e => setSelectedStory({...selectedStory, voiceName: e.target.value})}>
                        {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-bold text-muted">Фоновая музыка</label>
                      <select className="form-select form-select-sm" value={selectedStory.musicMood} onChange={e => setSelectedStory({...selectedStory, musicMood: e.target.value})}>
                        {Object.keys(MUSIC_TRACKS).map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="col-md-4 d-flex align-items-end">
                      <button onClick={() => setSelectedStory({...selectedStory, showSubtitles: !selectedStory.showSubtitles})} className={`btn btn-sm w-100 fw-bold ${selectedStory.showSubtitles ? 'btn-primary' : 'btn-outline-secondary'}`}>
                        Субтитры: {selectedStory.showSubtitles ? 'ВКЛ' : 'ВЫКЛ'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="overflow-auto custom-scrollbar pe-2" style={{maxHeight: '70vh'}}>
                  {selectedStory.storyboard.map((scene, i) => (
                    <div key={scene.id} className="card p-3 mb-3 border">
                      <div className="row g-3">
                        <div className="col-auto">
                          <div className="position-relative" style={{width: '120px', height: '160px'}}>
                            <img src={pages.find(p => p.id === scene.imageReferenceId)?.url} className="w-100 h-100 rounded object-fit-cover border" />
                            <div className="position-absolute top-0 start-0 p-1">
                              <span className="badge bg-dark">#{i+1}</span>
                            </div>
                            <div className="position-absolute bottom-0 start-0 w-100 p-1 bg-dark bg-opacity-75 d-flex justify-content-center gap-2 rounded-bottom">
                               <button onClick={() => previewScene(scene)} className="btn btn-sm btn-link text-white p-0"><Eye size={16}/></button>
                               <button onClick={() => {
                                 const upd = [...selectedStory.storyboard]; 
                                 upd.splice(i+1, 0, {...scene, id: Math.random().toString()}); 
                                 setSelectedStory({...selectedStory, storyboard: upd});
                               }} className="btn btn-sm btn-link text-white p-0"><Copy size={16}/></button>
                            </div>
                          </div>
                        </div>
                        <div className="col">
                          <textarea className="form-control form-control-sm mb-3 border-0 bg-light" rows={3} value={scene.voiceoverText} onChange={e => {
                            const upd = [...selectedStory.storyboard]; upd[i].voiceoverText = e.target.value; setSelectedStory({...selectedStory, storyboard: upd});
                          }} />
                          <div className="row g-2">
                             <div className="col-4">
                               <label className="small text-muted fw-bold">Камера</label>
                               <select className="form-select form-select-sm" value={scene.motionType} onChange={e => {
                                 const upd = [...selectedStory.storyboard]; upd[i].motionType = e.target.value as MotionType; setSelectedStory({...selectedStory, storyboard: upd});
                               }}>
                                 <option value="SMART_FOCUS">Фокус</option>
                                 <option value="ZOOM_IN">Наезд</option>
                                 <option value="ZOOM_OUT">Отъезд</option>
                               </select>
                             </div>
                             <div className="col-4">
                               <label className="small text-muted fw-bold">FX</label>
                               <select className="form-select form-select-sm text-warning fw-bold" value={scene.actionFx} onChange={e => {
                                 const upd = [...selectedStory.storyboard]; upd[i].actionFx = e.target.value as ActionFxType; setSelectedStory({...selectedStory, storyboard: upd});
                               }}>
                                 {FX_LIST.map(f => <option key={f} value={f}>{f}</option>)}
                               </select>
                             </div>
                             <div className="col-4">
                               <label className="small text-muted fw-bold">Длит.(сек)</label>
                               <input type="number" step="0.5" className="form-control form-control-sm" value={scene.duration} onChange={e => {
                                 const upd = [...selectedStory.storyboard]; upd[i].duration = parseFloat(e.target.value); setSelectedStory({...selectedStory, storyboard: upd});
                               }} />
                             </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-lg-4">
                <div className="sticky-top" style={{top: '1rem'}}>
                  <div className="card p-3 bg-dark mb-4" style={{aspectRatio: '9/16'}}>
                    <canvas ref={editorCanvasRef} width={720} height={1280} className="w-100 h-100 object-fit-contain bg-black rounded" />
                  </div>
                  <button onClick={assembleVideo} disabled={renderJob.status === 'rendering'} className="btn btn-primary w-100 py-3 fw-bold d-flex align-items-center justify-content-center gap-2 shadow">
                    <Zap size={20} fill="currentColor" /> {renderJob.status === 'rendering' ? 'Сборка видео...' : 'Сгенерировать Reels'}
                  </button>
                  <p className="text-center text-muted small mt-3">Параллельный рендеринг в фоне активен</p>
                </div>
              </div>
            </div>
          )}

          {step === 4 && finalVideoUrl && (
            <div className="text-center py-5">
              <h2 className="fw-bold mb-5">Ваше видео готово!</h2>
              <div className="mx-auto bg-dark rounded-5 shadow-lg overflow-hidden border border-5 border-white" style={{maxWidth: '400px', aspectRatio: '9/16'}}>
                <video src={finalVideoUrl} controls autoPlay loop className="w-100 h-100 object-fit-cover" />
              </div>
              <div className="mt-5 d-flex justify-content-center gap-3">
                <a href={finalVideoUrl} download={`${selectedStory?.title}.mp4`} className="btn btn-primary btn-lg px-5 d-flex align-items-center gap-2">
                  <Download size={24} /> Скачать MP4
                </a>
                <button onClick={() => setView('library')} className="btn btn-outline-secondary btn-lg px-5">В библиотеку</button>
              </div>
            </div>
          )}
        </main>
      )}
      <footer className="container py-4 border-top text-center text-muted small mt-auto opacity-50">
        &copy; 2024 ComixReel AI Engine. Нейтральный дизайн v2.5
      </footer>
    </div>
  );
}
