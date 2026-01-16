import React, { useState, useCallback, useRef, useEffect } from 'react';
import { processImage } from './services/geminiService';
import { ImageSize, ProcessingState, ProcessedImage, AspectRatio, FilmStock, ISOValue } from './types';
import ComparisonSlider from './components/ComparisonSlider';
import { getHistory, saveHistoryItem, deleteHistoryItemFromDB, clearHistoryDB } from './services/dbService';

const SESSION_KEY = 'desynthesize_session_active';

const BASE_PROMPT_TEMPLATE = (intensity: number) => {
  let skinPrompt = "";
  if (intensity < 30) {
    skinPrompt = "Apply a light photographic grain and micro-texture to the skin, effectively removing synthetic digital smoothness while keeping the character's appearance clean and polished.";
  } else if (intensity > 70) {
    skinPrompt = "Apply professional high-fidelity skin reconstruction. Focus on restoring intricate skin details like natural pore structure and fine organic textures. The result should feel raw and authentic, resembling an unretouched high-resolution film negative, while honoring the character's original features and avoiding any exaggerated blemishes.";
  } else {
    skinPrompt = "Restore realistic skin texture with natural variation. Preserve the character's features while adding the subtle depth and organic feel of real skin, effectively bridging the gap between digital generation and authentic photography.";
  }
  
  return `A portrait with ${skinPrompt}, while maintaining consistent lighting, props, and set design.`;
};

const FILM_STOCK_CHARACTERISTICS: Record<FilmStock, string> = {
  'Kodak Portra 400': 'Legendary skin tones. Warm, golden hues with a natural highlight roll-off. Ideal for portraits requiring a soft, organic feel.',
  'Kodak Gold 200': 'The classic consumer aesthetic. Saturated yellows and punchy reds with a warm, nostalgic 90s snapshot vibe.',
  'Kodak Ektachrome E100': 'Professional color reversal film. Exceptional sharpness, clean cool shadows, and neutral, realistic whites.',
  'Kodak Tri-X 400 (B&W)': 'High-contrast monochrome. Gritty, punchy textures with deep blacks and a legendary journalistic character.',
  'Fujifilm Velvia 50': 'Hyper-saturated color. Intense greens and magentas with very high contrast. A distinctive, high-drama slide film look.',
  'Fujifilm Provia 100F': 'Balanced professional slide film. Neutral color reproduction with incredible sharpness and fine grain structure.',
  'Fujifilm Pro 400H': 'Pastel palette. Soft, airy tones with a signature subtle cyan/green tint in the shadows. Perfect for ethereal lighting.',
  'Ilford HP5 Plus (B&W)': 'Classic street photography film. Wide tonal range with a punchy, organic grain that feels raw and authentic.',
  'Cinestill 800T': 'Cinematic tungsten-balanced film. Unique "red glow" halation around bright lights with a cool, moody night-time color shift.'
};

interface ThemeConfig {
  brand: string;
  accent: string;
  logo: string;
  logoBg: string;
  logoText: string;
}

const THEMES: Record<string, ThemeConfig> = {
  kodak: {
    brand: '#E12127', // Red
    accent: '#FFD500', // Yellow
    logo: 'K',
    logoBg: '#FFD500',
    logoText: '#E12127'
  },
  fuji: {
    brand: '#00843D', // Fuji Green
    accent: '#FFFFFF', // White
    logo: 'F',
    logoBg: '#FFFFFF',
    logoText: '#00843D'
  },
  mono: {
    brand: '#FFFFFF', // White
    accent: '#444444', // Dark Grey
    logo: 'I',
    logoBg: '#222222',
    logoText: '#FFFFFF'
  }
};

const getThemeForStock = (stock: FilmStock): ThemeConfig => {
  if (stock.includes('Kodak') && !stock.includes('B&W')) return THEMES.kodak;
  if (stock.includes('Fujifilm')) return THEMES.fuji;
  if (stock.includes('Cinestill')) return { ...THEMES.mono, logo: 'C' };
  if (stock.includes('B&W') || stock.includes('Ilford')) return THEMES.mono;
  return THEMES.kodak;
};

const calculateClosestAspectRatio = (width: number, height: number): AspectRatio => {
  const ratio = width / height;
  const standardRatios: { ratio: number; value: AspectRatio }[] = [
    { ratio: 1, value: '1:1' },
    { ratio: 3/4, value: '3:4' },
    { ratio: 4/3, value: '4:3' },
    { ratio: 9/16, value: '9:16' },
    { ratio: 16/9, value: '16:9' },
  ];
  return standardRatios.reduce((prev, curr) => 
    Math.abs(curr.ratio - ratio) < Math.abs(prev.ratio - ratio) ? curr : prev
  ).value;
};

const getDownloadFilename = (stock: string, isoValue: number, ts?: number) => {
  const date = ts ? new Date(ts) : new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  
  const dateStr = `${year}${month}${day}-${hours}${minutes}${seconds}`;
  const slug = stock.replace(/[()]/g, '').trim().replace(/\s+/g, '-');
  return `${slug}-iso${isoValue}-${dateStr}.png`;
};

const App: React.FC = () => {
  const [originalBase64, setOriginalBase64] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>({ status: 'idle' });
  const [imageSize, setImageSize] = useState<ImageSize>('1K');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [filmStock, setFilmStock] = useState<FilmStock>('Kodak Portra 400');
  const [iso, setIso] = useState<ISOValue>(400);
  const [skinDetail, setSkinDetail] = useState<number>(50);
  const [history, setHistory] = useState<ProcessedImage[]>([]);
  const [compareMode, setCompareMode] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [isKeyReady, setIsKeyReady] = useState<boolean>(false);
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentTheme = getThemeForStock(filmStock);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--theme-brand', currentTheme.brand);
    root.style.setProperty('--theme-accent', currentTheme.accent);
    root.style.setProperty('--theme-logo-bg', currentTheme.logoBg);
    root.style.setProperty('--theme-logo-text', currentTheme.logoText);
  }, [filmStock, currentTheme]);

  useEffect(() => {
    const checkKeyStatus = async () => {
      const sessionActive = sessionStorage.getItem(SESSION_KEY) === 'true';
      const actuallyHasKey = await window.aistudio.hasSelectedApiKey();
      setIsKeyReady(sessionActive && actuallyHasKey);
    };
    checkKeyStatus();

    const loadHistory = async () => {
      try {
        const data = await getHistory();
        setHistory(data.map(item => ({ ...item, selected: false })));
      } catch (e) {
        console.error("Failed to load history from IndexedDB", e);
      }
    };
    loadHistory();
  }, []);

  const buildFinalPrompt = () => {
    const basePrompt = BASE_PROMPT_TEMPLATE(skinDetail);
    const grainPrompt = `Add a substantial amount of organic film grain, resembling a ${iso} ISO film to the image, preserving the original aesthetic. The grain should feel raw and authentic.`;
    const stockPrompt = FILM_STOCK_CHARACTERISTICS[filmStock];
    return `${basePrompt} ${stockPrompt} ${grainPrompt}`;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const detectedRatio = calculateClosestAspectRatio(img.width, img.height);
        setAspectRatio(detectedRatio);
        setOriginalBase64(result);
        setProcessedUrl(null);
        setProcessingState({ status: 'idle' });
        setZoomScale(1);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  const triggerDownload = async (dataUrl: string, filename: string) => {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
    } catch (err) {
      console.error("Blob download failed, falling back to data URL", err);
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      link.click();
    }
  };

  const handleKeyActivation = async () => {
    await window.aistudio.openSelectKey();
    sessionStorage.setItem(SESSION_KEY, 'true');
    setIsKeyReady(true);
    setShowKeyModal(false);
  };

  const startProcessing = async () => {
    if (!originalBase64) return;
    
    const sessionActive = sessionStorage.getItem(SESSION_KEY) === 'true';
    if (!sessionActive) {
      setShowKeyModal(true);
      return;
    }

    setProcessingState({ status: 'checking-key', message: 'Verifying Emulsion Engine...' });
    
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      setShowKeyModal(true);
      setProcessingState({ status: 'idle' });
      return;
    }
    
    setProcessingState({ status: 'processing', message: `Developing as ${filmStock} at ISO ${iso}...` });
    try {
      const base64Data = originalBase64.split(',')[1];
      const mimeType = originalBase64.split(';')[0].split(':')[1];
      const finalPrompt = buildFinalPrompt();
      const resultUrl = await processImage(base64Data, mimeType, finalPrompt, imageSize, aspectRatio);
      
      const newEntry: ProcessedImage = {
        id: Date.now().toString(),
        originalUrl: originalBase64,
        processedUrl: resultUrl,
        timestamp: Date.now(),
        prompt: finalPrompt,
        size: imageSize,
        aspectRatio: aspectRatio,
        filmStock: filmStock,
        iso: iso,
        skinDetail: skinDetail,
        selected: false
      };
      
      setProcessedUrl(resultUrl);
      await saveHistoryItem(newEntry);
      setHistory(prev => [newEntry, ...prev]);
      setProcessingState({ status: 'idle' });
      setZoomScale(1);
      setIsKeyReady(true);
    } catch (err: any) {
      if (err.message === "KEY_RESET_REQUIRED") {
        sessionStorage.removeItem(SESSION_KEY);
        setShowKeyModal(true);
        setProcessingState({ status: 'idle' });
        return;
      }
      setProcessingState({ status: 'error', message: err.message || 'Chemical imbalance detected.' });
    }
  };

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item));
  };

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteHistoryItemFromDB(id);
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const handleZoom = (delta: number) => {
    setZoomScale(prev => Math.min(Math.max(prev + delta, 1), 4));
  };

  const parseErrorMessage = (msg: string) => {
    if (msg.startsWith("REJECTION:")) {
      const parts = msg.split("WHY:");
      const main = parts[0].replace("REJECTION:", "").trim();
      const whyAndRemedy = parts[1] ? parts[1].split("REMEDY:") : [null, null];
      return {
        type: 'rejection',
        main: main,
        why: whyAndRemedy[0]?.trim(),
        remedy: whyAndRemedy[1]?.trim()
      };
    }
    return { type: 'error', main: msg };
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-kodak-dark text-kodak-cream selection:bg-kodak-yellow selection:text-kodak-dark theme-transition">
      {/* Key Activation Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-[#2a2a2a] border-4 border-kodak-red p-8 shadow-[20px_20px_0px_#111] space-y-6 theme-transition">
            <div className="flex items-center gap-4 border-b-2 border-kodak-yellow pb-4">
               <div className="w-10 h-10 flex items-center justify-center bg-kodak-yellow text-kodak-red font-display text-2xl rotate-3">K</div>
               <h2 className="font-display text-4xl text-kodak-yellow uppercase tracking-tighter">Activation Required</h2>
            </div>
            <div className="space-y-4">
              <p className="text-sm font-bold leading-relaxed uppercase tracking-widest text-kodak-cream/80">
                This application utilizes the <span className="text-kodak-yellow">Google Gemini 3 Pro Vision</span> engine to reconstruct photographic textures.
                <br/><br/>
                A <span className="text-kodak-red font-black">Paid Google Cloud project</span> with billing enabled is required. Small usage fees will apply to your Google account per image developed.
              </p>
              <a 
                href="https://ai.google.dev/gemini-api/docs/billing" 
                target="_blank" 
                rel="noopener noreferrer"
                title="Review Gemini API pricing, project requirements, and usage billing"
                className="inline-block text-xs font-black text-kodak-yellow hover:text-white uppercase tracking-widest underline underline-offset-4 decoration-2"
              >
                View Billing Documentation
              </a>
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={handleKeyActivation}
                title="Authenticate your Google Cloud Project to begin developing"
                className="w-full py-4 bg-kodak-red text-kodak-yellow font-display text-2xl uppercase border-b-4 border-black/20 hover:brightness-110 active:translate-y-1 active:border-b-0 transition-all"
              >
                Select API Key
              </button>
              <button 
                onClick={() => setShowKeyModal(false)}
                title="Return to the Lab without activating a session"
                className="w-full py-2 text-xs font-black text-kodak-yellow/40 hover:text-kodak-yellow uppercase tracking-[0.2em] transition-colors"
              >
                Maybe Later
              </button>
            </div>
            <p className="text-[10px] text-center italic text-kodak-red/60 uppercase font-black">
              Session-bound authentication. You will be asked to re-link your project each time the browser window is closed.
            </p>
          </div>
        </div>
      )}

      <div className="w-full max-w-7xl px-4 py-8 md:py-12 space-y-12">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b-4 border-kodak-red pb-8 theme-transition">
          <div className="space-y-1">
            <div className="flex items-center gap-4">
              <div 
                className="w-14 h-14 flex items-center justify-center rotate-3 border-4 border-kodak-red shadow-[-4px_4px_0px_var(--theme-brand)] theme-transition cursor-help"
                style={{ backgroundColor: 'var(--theme-logo-bg)' }}
                title={`Emulsion Core Brand: ${filmStock.includes('Fuji') ? 'Fujifilm' : filmStock.includes('Cinestill') ? 'Cinestill' : 'Kodak'}`}
              >
                <span 
                  className="font-display text-4xl leading-none theme-transition"
                  style={{ color: 'var(--theme-logo-text)' }}
                >
                  {currentTheme.logo}
                </span>
              </div>
              <h1 className="font-display text-6xl tracking-tight text-kodak-yellow uppercase drop-shadow-[2px_2px_0px_var(--theme-brand)] theme-transition">
                De-Synthesize <span className="text-kodak-red theme-transition">Pro</span>
              </h1>
            </div>
            <p className="text-kodak-yellow/70 font-bold text-xs uppercase tracking-[0.3em] theme-transition">Analog Texture Recovery System // Emulsion v2.9</p>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              {isKeyReady && (
                <span 
                  className="flex items-center gap-1.5 text-[9px] font-black text-kodak-yellow uppercase tracking-widest bg-kodak-red/20 px-2 py-1 theme-transition"
                  title="Your Gemini API project is successfully linked for this session"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-kodak-yellow animate-pulse" />
                  Session Active
                </span>
              )}
              <button 
                onClick={() => setShowKeyModal(true)} 
                title="Connect or switch your Google Gemini API project"
                className="px-6 py-2 bg-kodak-red hover:brightness-110 text-kodak-yellow font-display text-xl border-b-4 border-black/20 active:translate-y-1 active:border-b-0 transition-all theme-transition"
              >
                {isKeyReady ? 'Update Key' : 'Activate Session'}
              </button>
            </div>
            <a 
              href="https://ai.google.dev/gemini-api/docs/billing" 
              target="_blank" 
              rel="noopener noreferrer"
              title="Official Google guide on setting up billing for Gemini API"
              className="text-[9px] font-black text-kodak-yellow/60 hover:text-kodak-yellow uppercase tracking-widest theme-transition underline underline-offset-4"
            >
              Get your Gemini API Key to use the app.
            </a>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <aside className="lg:col-span-4 space-y-6">
            <section className="bg-[#2a2a2a] border-l-8 border-kodak-yellow p-6 shadow-2xl space-y-6 theme-transition">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-kodak-yellow uppercase tracking-[0.2em] theme-transition">Film Loading Slot</label>
                <div 
                  onClick={() => fileInputRef.current?.click()} 
                  title="Click to select an AI-generated image (JPG, PNG) for developing"
                  className={`group relative flex flex-col items-center justify-center aspect-video border-4 border-dashed rounded-none cursor-pointer transition-all duration-300 ${originalBase64 ? 'border-kodak-yellow bg-kodak-yellow/10' : 'border-kodak-red/30 hover:border-kodak-yellow hover:bg-kodak-yellow/5'} theme-transition`}
                >
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                  {originalBase64 ? (
                    <img src={originalBase64} alt="Preview" className="w-full h-full object-cover opacity-60" />
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-10 h-10 text-kodak-red theme-transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span className="font-display text-xl text-kodak-yellow theme-transition">Insert Image</span>
                    </div>
                  )}
                  {originalBase64 && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-kodak-dark/80">
                      <span className="font-display text-2xl text-kodak-yellow theme-transition">Eject & Replace</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5 pt-4 border-t-2 border-kodak-red/20 theme-transition">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-kodak-yellow uppercase tracking-[0.2em] theme-transition">Select Emulsion</label>
                  <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar">
                    {(Object.keys(FILM_STOCK_CHARACTERISTICS) as FilmStock[]).map((stock) => (
                      <button
                        key={stock}
                        onClick={() => setFilmStock(stock)}
                        title={`Select ${stock}: ${FILM_STOCK_CHARACTERISTICS[stock]}`}
                        className={`px-3 py-2 text-left font-display text-sm md:text-lg transition-all border-2 theme-transition leading-tight flex flex-col justify-center min-h-[64px] ${
                          filmStock === stock 
                            ? 'bg-kodak-red border-kodak-yellow text-kodak-yellow shadow-[4px_4px_0px_var(--theme-accent)]' 
                            : 'bg-kodak-dark border-kodak-red/30 text-kodak-red/40 hover:border-kodak-red hover:text-kodak-red'
                        }`}
                      >
                        <span className="uppercase tracking-tighter">{stock.split(' (')[0]}</span>
                        {stock.includes('(B&W)') && <span className="text-[8px] font-black opacity-60 tracking-[0.1em] mt-1">MONO</span>}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                   <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-kodak-yellow uppercase tracking-[0.2em] theme-transition">Skin Texture Recovery</label>
                    <span className="font-display text-2xl text-kodak-red theme-transition" title="Intensity of organic skin feature reconstruction">{skinDetail}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    step="5" 
                    value={skinDetail} 
                    onChange={(e) => setSkinDetail(parseInt(e.target.value))} 
                    title="Slide to adjust skin grain and texture depth. High values create a raw, unretouched negative feel."
                    className="w-full h-2 bg-kodak-dark rounded-lg appearance-none cursor-pointer border-2 border-kodak-red accent-kodak-yellow theme-transition" 
                  />
                  <div className="flex justify-between text-[8px] font-black text-kodak-red uppercase tracking-widest theme-transition">
                    <span>Polished</span>
                    <span>Natural</span>
                    <span>Film Detail</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-kodak-yellow uppercase tracking-[0.2em] theme-transition">Speed (ISO)</label>
                    <span className="font-display text-2xl text-kodak-red theme-transition" title="Current film speed setting">{iso}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[200, 400, 800, 1600].map((val) => (
                      <button
                        key={val}
                        onClick={() => setIso(val as ISOValue)}
                        title={`ISO ${val}: ${val <= 400 ? 'Fine, clean grain structure' : 'Course, moody grain structure'}`}
                        className={`py-2 font-display text-xl transition-all border-2 theme-transition ${iso === val ? 'bg-kodak-red border-kodak-yellow text-kodak-yellow shadow-[4px_4px_0px_var(--theme-accent)]' : 'bg-kodak-dark border-kodak-red/50 text-kodak-red/50 hover:border-kodak-red hover:text-kodak-red'}`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-kodak-yellow uppercase tracking-widest theme-transition">Ratio</p>
                    <div 
                      title="Aspect ratio detected from your source image"
                      className="bg-kodak-dark border border-kodak-red/30 p-2 text-center text-kodak-yellow/80 font-display text-lg theme-transition"
                    >
                      {aspectRatio}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-kodak-yellow uppercase tracking-widest theme-transition">Res</p>
                    <select 
                      value={imageSize} 
                      onChange={(e) => setImageSize(e.target.value as ImageSize)} 
                      title="Select the target resolution for the output print"
                      className="w-full bg-kodak-dark border border-kodak-red/30 p-2 text-kodak-yellow/80 font-display text-lg outline-none theme-transition"
                    >
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                  </div>
                </div>
              </div>

              <button 
                onClick={startProcessing} 
                disabled={!originalBase64 || processingState.status !== 'idle'} 
                title="Initialize the development process using Gemini 3 Pro Vision"
                className="w-full py-6 bg-kodak-yellow disabled:bg-kodak-dark disabled:text-kodak-red/20 text-kodak-dark font-display text-4xl uppercase tracking-tighter hover:brightness-110 active:translate-y-1 transition-all shadow-[-8px_8px_0px_var(--theme-brand)] theme-transition"
              >
                {processingState.status === 'idle' ? 'Start Developing' : 'In Lab...'}
              </button>
            </section>
          </aside>

          <main className="lg:col-span-8 flex flex-col gap-8">
            {compareMode ? (
              <div className="flex-1 space-y-12 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex items-center justify-between border-b-2 border-kodak-red pb-4 theme-transition">
                  <h2 className="font-display text-4xl text-kodak-yellow uppercase tracking-tighter theme-transition">Stack Comparison ({history.filter(h => h.selected).length})</h2>
                  <button onClick={() => setCompareMode(false)} title="Close comparison and return to development area" className="px-6 py-2 bg-kodak-yellow text-kodak-dark font-display text-xl border-4 border-kodak-red theme-transition">Back to Lab</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {history.filter(h => h.selected).map(item => (
                    <div key={item.id} className="space-y-4 bg-[#2a2a2a] p-4 border-l-4 border-kodak-red theme-transition">
                      <ComparisonSlider original={item.originalUrl} processed={item.processedUrl} aspectRatio={item.aspectRatio} />
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="font-display text-2xl text-kodak-yellow uppercase theme-transition">{item.filmStock} @ ISO {item.iso}</span>
                          <span className="text-[10px] font-black text-kodak-red uppercase tracking-widest theme-transition">Texture Reconstruction: {item.skinDetail}%</span>
                        </div>
                        <button 
                          onClick={() => triggerDownload(item.processedUrl, getDownloadFilename(item.filmStock, item.iso, item.timestamp))} 
                          title="Download this specific version" 
                          className="text-kodak-red font-bold text-xs uppercase hover:underline theme-transition"
                        >
                          Download Fix
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : processingState.status !== 'idle' && processingState.status !== 'error' ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-[#1e1e1e] border-8 border-kodak-red/10 min-h-[600px] p-12 text-center relative overflow-hidden theme-transition">
                <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, var(--theme-brand) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
                <div className="relative w-32 h-32 mb-8">
                  <div className="absolute inset-0 border-8 border-kodak-yellow/20 rounded-full theme-transition" />
                  <div className="absolute inset-0 border-8 border-transparent border-t-kodak-red rounded-full animate-spin theme-transition" />
                  <div className="absolute inset-6 bg-kodak-red/10 flex items-center justify-center theme-transition">
                    <span className="font-display text-4xl text-kodak-red animate-pulse theme-transition">FIX</span>
                  </div>
                </div>
                <h3 className="font-display text-5xl text-kodak-yellow mb-4 uppercase theme-transition">DEVELOPING FILM</h3>
                <p className="text-kodak-cream/60 font-bold text-sm max-w-xs mx-auto uppercase tracking-widest leading-relaxed theme-transition">{processingState.message}</p>
              </div>
            ) : processedUrl && originalBase64 ? (
              <div className="space-y-8 animate-in slide-in-from-bottom-8 duration-700">
                <div className="bg-[#2a2a2a] p-2 border-t-8 border-kodak-yellow shadow-[20px_20px_0px_#111] relative theme-transition">
                  <div className="absolute top-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
                    <div className="flex flex-col bg-kodak-dark border-4 border-kodak-red shadow-2xl pointer-events-auto overflow-hidden">
                      <button 
                        onClick={() => handleZoom(0.5)} 
                        title="Increase view magnification to inspect grain" 
                        className="w-14 h-14 flex items-center justify-center text-kodak-yellow hover:bg-kodak-red transition-all active:scale-95 border-b-2 border-kodak-red/30"
                      >
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                      </button>
                      <button 
                        onClick={() => setZoomScale(1)} 
                        title="Reset magnification to original size" 
                        className="w-14 h-14 flex items-center justify-center text-xs font-black text-kodak-red hover:bg-kodak-yellow hover:text-kodak-dark transition-all uppercase border-b-2 border-kodak-red/30"
                      >
                        1:1
                      </button>
                      <button 
                        onClick={() => handleZoom(-0.5)} 
                        title="Decrease view magnification" 
                        className="w-14 h-14 flex items-center justify-center text-kodak-yellow hover:bg-kodak-red transition-all active:scale-95"
                      >
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                      </button>
                    </div>
                  </div>
                  
                  <div style={{ height: 'auto', maxHeight: '80vh' }} className="overflow-hidden">
                    <ComparisonSlider 
                      original={originalBase64} 
                      processed={processedUrl} 
                      aspectRatio={aspectRatio} 
                      zoomScale={zoomScale} 
                    />
                  </div>
                </div>
                
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-8 bg-kodak-red border-4 border-kodak-yellow shadow-2xl relative overflow-hidden group theme-transition">
                  <div className="space-y-1 relative z-10">
                    <h3 className="font-display text-5xl text-kodak-yellow uppercase leading-none theme-transition">{filmStock} Complete</h3>
                    <p className="font-bold text-xs uppercase tracking-[0.2em] text-white/80 theme-transition">Photographic authenticity restored with {skinDetail}% texture reconstruction.</p>
                  </div>
                  <div className="flex items-center gap-4 relative z-10">
                    <button onClick={() => { setProcessedUrl(null); setZoomScale(1); }} title="Clear and load another negative" className="px-8 py-3 bg-kodak-dark text-kodak-yellow font-display text-xl border-2 border-kodak-yellow hover:bg-kodak-yellow hover:text-kodak-dark transition-all theme-transition">New Negative</button>
                    <button 
                      onClick={() => triggerDownload(processedUrl, getDownloadFilename(filmStock, iso))} 
                      title="Export the developed print as a high-quality PNG" 
                      className="px-10 py-3 bg-kodak-yellow text-kodak-dark font-display text-3xl uppercase tracking-tighter shadow-[-6px_6px_0px_var(--theme-bg)] hover:translate-x-1 hover:-translate-y-1 hover:shadow-[-10px_10px_0px_var(--theme-bg)] active:translate-x-0 active:translate-y-0 active:shadow-none transition-all theme-transition"
                    >
                      Save Print
                    </button>
                  </div>
                </div>
              </div>
            ) : processingState.status === 'error' ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-kodak-red/10 border-8 border-kodak-red p-12 text-center animate-in shake duration-500 theme-transition">
                <h3 className="font-display text-6xl text-kodak-red mb-6 uppercase tracking-tighter theme-transition">Lab Exposure Error</h3>
                
                <div className="bg-kodak-dark p-6 border-4 border-kodak-red mb-8 max-w-lg theme-transition w-full">
                  {(() => {
                    const parsed = parseErrorMessage(processingState.message || "");
                    if (parsed.type === 'rejection') {
                      return (
                        <div className="text-left space-y-4">
                          <p className="font-display text-2xl text-kodak-yellow uppercase tracking-tight">{parsed.main}</p>
                          <div className="space-y-2">
                             <p className="text-[10px] font-black text-kodak-red uppercase tracking-widest">WHY:</p>
                             <p className="text-sm text-kodak-cream/80 italic font-medium leading-relaxed">{parsed.why}</p>
                          </div>
                          <div className="space-y-2 pt-2 border-t border-kodak-red/30">
                             <p className="text-[10px] font-black text-kodak-yellow uppercase tracking-widest">HOW TO FIX:</p>
                             <p className="text-sm text-kodak-yellow font-bold leading-relaxed">{parsed.remedy}</p>
                          </div>
                        </div>
                      );
                    }
                    return <p className="font-mono text-sm text-kodak-red/80 uppercase theme-transition">Status: FAILED_RECONSTRUCTION<br/>Message: {processingState.message}</p>;
                  })()}
                </div>
                
                <button 
                  onClick={() => setProcessingState({ status: 'idle' })} 
                  title="Clear error state and return to lab setup"
                  className="px-12 py-4 bg-kodak-red text-kodak-yellow font-display text-3xl uppercase border-b-8 border-black/20 active:border-b-0 transition-all theme-transition"
                >
                  Restart Lab
                </button>
              </div>
            ) : (
              <div onClick={() => fileInputRef.current?.click()} title="Drag and drop or click to upload an AI image" className="flex-1 min-h-[600px] flex flex-col items-center justify-center border-8 border-dashed border-[#2a2a2a] bg-[#111] p-12 text-center group cursor-pointer hover:border-kodak-red transition-all duration-700 shadow-inner theme-transition">
                <div className="w-32 h-32 bg-kodak-dark border-4 border-kodak-red rotate-3 flex items-center justify-center mb-10 shadow-[8px_8px_0px_var(--theme-brand)] group-hover:rotate-0 group-hover:scale-110 transition-all duration-500 theme-transition"><svg className="w-14 h-14 text-kodak-red group-hover:text-kodak-yellow theme-transition" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg></div>
                <h3 className="font-display text-6xl text-kodak-yellow mb-4 uppercase tracking-tighter theme-transition">Drop Synthetic Frame</h3>
                <p className="text-kodak-cream/40 font-bold text-sm max-w-sm mx-auto uppercase tracking-[0.3em] leading-loose theme-transition">Detection enabled for Midjourney and Flux sources. Ready for grain injection.</p>
              </div>
            )}
          </main>
        </div>

        <section className="space-y-6 pt-12 border-t-4 border-kodak-yellow/20 theme-transition">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 px-2">
            <div className="flex items-center gap-4">
              <h3 className="font-display text-5xl text-kodak-yellow uppercase tracking-tighter theme-transition">THE CONTACT SHEET</h3>
              <span className="text-[10px] font-black text-kodak-red uppercase tracking-widest bg-kodak-red/10 px-3 py-1 theme-transition">Stored Prints: {history.length}</span>
            </div>
            {history.filter(h => h.selected).length > 0 && (
              <button 
                onClick={() => { setCompareMode(!compareMode); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
                title="Inspect selected items in side-by-side comparison mode"
                className="px-8 py-2 bg-kodak-red text-kodak-yellow font-display text-2xl border-4 border-kodak-yellow animate-pulse hover:scale-105 active:scale-95 transition-all theme-transition"
              >
                Compare Selected ({history.filter(h => h.selected).length})
              </button>
            )}
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 max-h-[600px] overflow-y-auto p-4 bg-black/20 border-2 border-white/5 custom-scrollbar theme-transition">
            {history.length === 0 ? (
              <div className="col-span-full py-20 text-center opacity-20">
                <span className="font-display text-4xl uppercase theme-transition">No prints developed yet</span>
              </div>
            ) : (
              history.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => { 
                    setOriginalBase64(item.originalUrl); 
                    setProcessedUrl(item.processedUrl); 
                    setAspectRatio(item.aspectRatio); 
                    setImageSize(item.size); 
                    setFilmStock(item.filmStock); 
                    setIso(item.iso); 
                    setSkinDetail(item.skinDetail || 50); 
                    setZoomScale(1);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }} 
                  title={`View print: ${item.filmStock} @ ISO ${item.iso}`}
                  className={`group relative aspect-[4/5] overflow-hidden border-4 transition-all cursor-pointer theme-transition shadow-lg ${item.selected ? 'border-kodak-yellow scale-95' : 'border-[#2a2a2a] hover:border-kodak-red'}`}
                >
                  <img src={item.processedUrl} alt="History" className="w-full h-full object-cover" />
                  <div className="absolute top-2 left-2 z-30" onClick={(e) => toggleSelection(item.id, e)} title="Click to select for comparison">
                    <div className={`w-8 h-8 border-2 flex items-center justify-center transition-all ${item.selected ? 'bg-kodak-yellow border-kodak-dark' : 'bg-black/40 border-white'} theme-transition`}>
                      {item.selected && <svg className="w-5 h-5 text-kodak-dark theme-transition" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-kodak-dark/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2 text-center">
                    <span className="font-display text-xl text-kodak-yellow leading-tight theme-transition">{item.filmStock}</span>
                    <span className="text-[10px] font-bold text-kodak-red uppercase theme-transition">ISO {item.iso}</span>
                    <span className="text-[8px] font-bold text-kodak-cream uppercase tracking-widest mt-1 theme-transition">{item.skinDetail}% Detail</span>
                  </div>
                  <button onClick={(e) => deleteHistoryItem(item.id, e)} title="Delete this print from lab history" className="absolute top-2 right-2 w-8 h-8 bg-kodak-red text-kodak-yellow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white hover:text-kodak-red theme-transition">×</button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); triggerDownload(item.processedUrl, getDownloadFilename(item.filmStock, item.iso, item.timestamp)); }} 
                    title="Download this print" 
                    className="absolute bottom-2 right-2 w-10 h-10 bg-kodak-yellow text-kodak-dark rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 shadow-xl theme-transition"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4-4v12" /></svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <footer className="pt-24 border-t-8 border-kodak-red flex flex-col items-center gap-8 text-center pb-20 theme-transition">
          <div className="flex items-center gap-4">
             <div className="w-8 h-8 theme-transition" style={{ backgroundColor: 'var(--theme-accent)' }} /><div className="w-8 h-8 theme-transition" style={{ backgroundColor: 'var(--theme-brand)' }} /><div className="w-8 h-8 bg-white theme-transition" />
          </div>
          <p className="text-kodak-yellow/40 font-bold text-xs max-w-2xl uppercase tracking-[0.4em] middle-loose theme-transition">PROCESSED BY DE-SYNTHESIZE PRO EMULSION ENGINE // GEMINI 3 PRO VISION CORE // MADE FOR PHOTOGRAPHERS BY ANALOG PURISTS.</p>
          <div className="font-display text-3xl text-kodak-red/30 uppercase tracking-[0.2em] theme-transition">©1976-2025 ANALOG RECOVERY LABS</div>
        </footer>
      </div>
    </div>
  );
};

export default App;