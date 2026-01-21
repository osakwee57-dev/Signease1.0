import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  PenTool, 
  Type as TypeIcon, 
  Download, 
  Trash2, 
  CheckCircle2, 
  Sparkles,
  Sliders,
  FileWarning
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

const MAX_FILE_SIZE_BYTES = 25 * 1024; // 25KB

const SignaturePad = () => {
  const [color, setColor] = useState('#000000');
  const [penWidth, setPenWidth] = useState(3);
  const [typedName, setTypedName] = useState('');
  const [typedWeight, setTypedWeight] = useState(0); 
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = useRef<{ x: number, y: number }[]>([]);
  const isDrawing = useRef(false);

  // Constants
  const DISPLAY_WIDTH = 600;
  const DISPLAY_HEIGHT = 350;

  const typedFonts = [
    { name: 'Dancing Script', class: 'font-cursive-dancing', family: "'Dancing Script', cursive" },
    { name: 'Pacifico', class: 'font-cursive-pacifico', family: "'Pacifico', cursive" },
    { name: 'Great Vibes', class: 'font-cursive-greatvibes', family: "'Great Vibes', cursive" },
    { name: 'Caveat', class: 'font-cursive-caveat', family: "'Caveat', cursive" },
    { name: 'Sacramento', class: 'font-cursive-sacramento', family: "'Sacramento', cursive" },
    { name: 'Monsieur La Doulaise', class: 'font-cursive-monsieur', family: "'Monsieur La Doulaise', cursive" }
  ];

  /**
   * Enforces the 25KB limit by iteratively reducing quality and dimensions
   */
  const getOptimizedDataUrl = async (sourceCanvas: HTMLCanvasElement, format: 'png' | 'jpg', hasWhiteBg: boolean): Promise<string> => {
    let scale = 1.0;
    let quality = 0.9;
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    
    // Create a working canvas for resizing
    const workCanvas = document.createElement('canvas');
    const workCtx = workCanvas.getContext('2d')!;

    while (scale > 0.05) {
      workCanvas.width = sourceCanvas.width * scale;
      workCanvas.height = sourceCanvas.height * scale;
      
      // Clear and Fill
      workCtx.clearRect(0, 0, workCanvas.width, workCanvas.height);
      if (hasWhiteBg) {
        workCtx.fillStyle = '#FFFFFF';
        workCtx.fillRect(0, 0, workCanvas.width, workCanvas.height);
      }
      
      // Draw scaled
      workCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, workCanvas.width, workCanvas.height);
      
      // Check size (Base64 is ~33% larger than binary, so we estimate)
      if (format === 'jpg') {
        // For JPG we can also try decreasing quality
        for (let q = quality; q > 0.1; q -= 0.1) {
          const dataUrl = workCanvas.toDataURL(mimeType, q);
          const size = Math.round((dataUrl.length - 22) * 3 / 4); // Basic base64 size estimation
          if (size <= MAX_FILE_SIZE_BYTES) return dataUrl;
        }
      } else {
        const dataUrl = workCanvas.toDataURL(mimeType);
        const size = Math.round((dataUrl.length - 22) * 3 / 4);
        if (size <= MAX_FILE_SIZE_BYTES) return dataUrl;
      }
      
      // If still too big, shrink dimensions further
      scale -= 0.15;
    }
    
    // Last ditch effort: tiny thumbnail
    return workCanvas.toDataURL(mimeType, 0.1);
  };

  const drawCanvasGuidelines = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) => {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 40; i < height; i += 30) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(width, i);
      ctx.stroke();
    }
    const lineY = height * 0.8;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, lineY);
    ctx.lineTo(width - 50, lineY);
    ctx.stroke();
    ctx.font = `bold ${24}px Inter`;
    ctx.fillStyle = 'rgba(71, 85, 105, 0.4)';
    ctx.fillText('X', 55, lineY - 10);
    ctx.restore();
  }, []);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rectWidth = window.innerWidth < 640 ? window.innerWidth - 48 : DISPLAY_WIDTH;
    const rectHeight = DISPLAY_HEIGHT;
    canvas.width = rectWidth * dpr;
    canvas.height = rectHeight * dpr;
    canvas.style.width = `${rectWidth}px`;
    canvas.style.height = `${rectHeight}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawCanvasGuidelines(ctx, rectWidth, rectHeight, dpr);
    }
  }, [drawCanvasGuidelines]);

  useEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, [setupCanvas]);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawing.current = true;
    const coords = getCoordinates(e);
    points.current = [coords];
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const coords = getCoordinates(e);
    points.current.push(coords);
    if (points.current.length < 3) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = penWidth;
    ctx.moveTo(points.current[0].x, points.current[0].y);
    for (let i = 1; i < points.current.length - 2; i++) {
      const xc = (points.current[i].x + points.current[i + 1].x) / 2;
      const yc = (points.current[i].y + points.current[i + 1].y) / 2;
      ctx.quadraticCurveTo(points.current[i].x, points.current[i].y, xc, yc);
    }
    const n = points.current.length;
    ctx.quadraticCurveTo(points.current[n - 2].x, points.current[n - 2].y, points.current[n - 1].x, points.current[n - 1].y);
    ctx.stroke();
  };

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;
    drawCanvasGuidelines(ctx, canvas.width / dpr, canvas.height / dpr, dpr);
    setAiAnalysis(null);
  };

  const downloadAsImage = async (format: 'png' | 'jpg') => {
    if (!canvasRef.current || isOptimizing) return;
    setIsOptimizing(true);
    
    try {
      const optimizedUrl = await getOptimizedDataUrl(canvasRef.current, format, format === 'jpg');
      const link = document.createElement('a');
      link.download = `signature.${format}`;
      link.href = optimizedUrl;
      link.click();
    } catch (e) {
      console.error("Download failed:", e);
    } finally {
      setIsOptimizing(false);
    }
  };

  const exportTypedSignature = async (name: string, font: string, format: 'png' | 'jpg') => {
    if (isOptimizing) return;
    setIsOptimizing(true);

    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d')!;
    const scale = 2;
    tempCanvas.width = 1200 * scale;
    tempCanvas.height = 400 * scale;

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${160 * scale}px ${font}`;

    if (typedWeight > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = typedWeight * scale * 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeText(name || 'Signature', tempCanvas.width / 2, tempCanvas.height / 2);
    }
    ctx.fillText(name || 'Signature', tempCanvas.width / 2, tempCanvas.height / 2);

    try {
      const optimizedUrl = await getOptimizedDataUrl(tempCanvas, format, format === 'jpg');
      const link = document.createElement('a');
      link.download = `typed-signature.${format}`;
      link.href = optimizedUrl;
      link.click();
    } finally {
      setIsOptimizing(false);
    }
  };

  const analyzeSignature = async () => {
    if (!canvasRef.current || isAnalyzing) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const base64Data = canvasRef.current.toDataURL('image/png').split(',')[1];
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/png' } },
            { text: "Briefly analyze the visual style of this digital signature in 2 sentences. Is it professional, creative, messy, or bold? Give a one-line tip for professional signing." }
          ]
        }
      });
      setAiAnalysis(response.text || "Analysis unavailable.");
    } catch (err) {
      setAiAnalysis("Could not analyze signature at this time.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div id="signature-tool" className="max-w-5xl mx-auto p-4 md:p-8 space-y-12">
      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 transition-all hover:shadow-indigo-100/50">
        <div className="p-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
        <div className="p-6 md:p-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                <PenTool className="text-indigo-600" /> Draw Your Signature
              </h2>
              <p className="text-slate-500 mt-1">Use your mouse or touch screen to sign below</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-4 bg-slate-50 p-3 rounded-2xl border border-slate-100">
              <div className="flex items-center gap-2 pr-4 border-r border-slate-200">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Ink Color</span>
                <button onClick={() => setColor('#000000')} className={`w-8 h-8 rounded-full border-2 transition-all ${color === '#000000' ? 'border-indigo-600 scale-110 shadow-lg' : 'border-white'}`} style={{ backgroundColor: '#000000' }} aria-label="Black Ink" />
                <button onClick={() => setColor('#0000FF')} className={`w-8 h-8 rounded-full border-2 transition-all ${color === '#0000FF' ? 'border-indigo-600 scale-110 shadow-lg' : 'border-white'}`} style={{ backgroundColor: '#0000FF' }} aria-label="Blue Ink" />
              </div>
              <div className="flex items-center gap-3 pr-4 border-r border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Size</span>
                  <input type="range" min="1" max="10" value={penWidth} onChange={(e) => setPenWidth(parseInt(e.target.value))} className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                </div>
              </div>
              <button onClick={clearCanvas} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:text-red-600 transition-colors"><Trash2 size={16} /> Clear</button>
            </div>
          </div>

          <div className="flex justify-center">
            <div className="relative group p-4 bg-slate-100 rounded-3xl shadow-inner">
              <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={() => (isDrawing.current = false)}
                onMouseLeave={() => (isDrawing.current = false)}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={() => (isDrawing.current = false)}
                className="signature-canvas bg-white rounded-2xl shadow-xl border border-slate-200 ring-1 ring-slate-900/5"
              />
            </div>
          </div>

          <div className="mt-10 flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-slate-100">
             <div className="flex items-center gap-4 w-full md:w-auto">
                <button onClick={analyzeSignature} disabled={isAnalyzing} className="flex items-center justify-center gap-2 px-6 py-4 bg-indigo-50 text-indigo-700 rounded-xl font-bold hover:bg-indigo-100 transition-all disabled:opacity-50 border border-indigo-100 shadow-sm">
                  <Sparkles size={20} className={isAnalyzing ? 'animate-pulse' : ''} />
                  {isAnalyzing ? 'Analyzing...' : 'AI Analysis'}
                </button>
             </div>
             <div className="flex flex-wrap justify-center gap-3 w-full md:w-auto">
                <div className="flex flex-col items-center gap-1 group">
                   <button onClick={() => downloadAsImage('png')} disabled={isOptimizing} className="flex items-center justify-center gap-2 px-6 py-4 bg-white text-slate-700 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50">
                     <Download size={20} /> PNG
                   </button>
                   <span className="text-[10px] text-slate-400 font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">Under 25KB</span>
                </div>
                <div className="flex flex-col items-center gap-1 group">
                   <button onClick={() => downloadAsImage('jpg')} disabled={isOptimizing} className="flex items-center justify-center gap-2 px-6 py-4 btn-gradient-indigo text-white rounded-xl font-bold transition-all shadow-xl shadow-indigo-200 disabled:opacity-50">
                     <Download size={20} /> JPG
                   </button>
                   <span className="text-[10px] text-slate-400 font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">Under 25KB</span>
                </div>
             </div>
          </div>

          {aiAnalysis && (
            <div className="mt-8 p-6 bg-indigo-50 rounded-2xl border border-indigo-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-start gap-3">
                <Sparkles className="text-indigo-600 mt-1 shrink-0" size={20} />
                <div>
                  <h4 className="font-bold text-indigo-900 mb-1">AI Signature Insight</h4>
                  <p className="text-indigo-800 leading-relaxed">{aiAnalysis}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100">
        <div className="p-6 md:p-10 space-y-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3"><TypeIcon className="text-indigo-600" /> Type Your Signature</h2>
              <p className="text-slate-500 mt-1">Convert your typed name into beautiful handwriting styles</p>
            </div>
            <div className="flex items-center gap-4 bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100">
               <div className="flex items-center gap-3">
                  <Sliders size={18} className="text-indigo-600" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Weight</span>
                  <input type="range" min="0" max="5" step="0.5" value={typedWeight} onChange={(e) => setTypedWeight(parseFloat(e.target.value))} className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
               </div>
            </div>
          </div>
          <div className="max-w-xl">
            <input id="typed-name" type="text" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Jonathan Doe" className="w-full px-8 py-5 text-2xl border-2 border-slate-100 bg-slate-50 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 focus:bg-white outline-none transition-all placeholder:text-slate-300 shadow-inner" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {typedFonts.map((font, idx) => (
              <div key={idx} className="relative group bg-slate-50 rounded-3xl border border-slate-100 p-8 flex flex-col items-center justify-center min-h-[240px] transition-all hover:bg-white hover:border-indigo-200 hover:shadow-xl hover:-translate-y-1">
                <div className="absolute top-4 left-6 text-[10px] font-bold text-slate-300 uppercase tracking-widest">{font.name}</div>
                <div className={`text-4xl md:text-5xl py-8 px-4 w-full break-words text-center ${font.class}`} style={{ color: color, WebkitTextStroke: typedWeight > 0 ? `${typedWeight}px ${color}` : 'none' }}>{typedName || 'Signature'}</div>
                <div className="flex gap-2 w-full mt-auto pt-4 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                  <button onClick={() => exportTypedSignature(typedName, font.family, 'png')} className="flex-1 bg-white border border-slate-200 text-slate-600 text-xs font-bold py-3 rounded-xl hover:bg-slate-50 flex items-center justify-center gap-2">PNG</button>
                  <button onClick={() => exportTypedSignature(typedName, font.family, 'jpg')} className="flex-1 bg-indigo-600 text-white text-xs font-bold py-3 rounded-xl hover:bg-indigo-700 flex items-center justify-center gap-2">JPG</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 text-slate-400 py-8">
        <div className="flex items-center gap-3">
          <FileWarning size={16} className="text-indigo-400" />
          <span className="text-sm font-bold uppercase tracking-widest text-indigo-400">Strict 25KB Output Limit</span>
        </div>
        <span className="text-sm font-medium">Files are automatically optimized to maintain compatibility with legacy document systems.</span>
      </div>
    </div>
  );
};

const Navbar = () => {
  return (
    <nav className="glass sticky top-0 z-50 border-b border-slate-200/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
            <div className="bg-indigo-600 p-2 rounded-lg group-hover:rotate-12 transition-transform"><PenTool className="text-white" size={24} /></div>
            <span className="text-2xl font-bold tracking-tight text-slate-900">Sign<span className="text-indigo-600">Ease</span></span>
          </div>
          <div className="flex items-center gap-6">
            {/* Action buttons could go here */}
          </div>
        </div>
      </div>
    </nav>
  );
};

const Hero = () => (
  <section className="relative pt-24 pb-12 overflow-hidden">
    <div className="max-w-7xl mx-auto px-4 text-center">
      <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-full text-sm font-semibold mb-6 border border-indigo-100">
        Professional-Grade Document Signing
      </div>
      <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
        Sign Anything, <br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-indigo-400">Anywhere.</span>
      </h1>
      <p className="text-xl text-slate-600 max-w-2xl mx-auto mb-10 leading-relaxed">
        High-fidelity digital signature creator with hand-drawn precision and typed cursive aesthetics.
      </p>
    </div>
  </section>
);

const Footer = () => (
  <footer className="py-12 border-t border-slate-200 bg-white mt-12">
    <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-8">
      <div className="flex items-center gap-2 opacity-50">
        <PenTool size={20} />
        <span className="text-lg font-bold">SignEase</span>
      </div>
      <p className="text-slate-500 text-sm">&copy; {new Date().getFullYear()} SignEase Digital Lab.</p>
      <div className="flex items-center gap-6">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Enterprise Ready</span>
      </div>
    </div>
  </footer>
);

const App = () => {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <Hero />
      <SignaturePad />
      <Footer />
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}