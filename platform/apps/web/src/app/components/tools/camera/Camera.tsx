import { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, Video, Square, Loader2, ScanText } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { putCapture } from '../../../data/localMedia';
import CameraCaptures from './CameraCaptures';

type Mode = 'photo' | 'video';

export default function Camera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [mode, setMode] = useState<Mode>('photo');
  const [on, setOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: mode === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setOn(true);
    } catch {
      setNote('Camera access denied or unavailable.');
      setTimeout(() => setNote(null), 3600);
    }
  }
  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
    setRecording(false);
  }
  useEffect(() => () => stop(), []);
  // Re-acquire stream when switching to video (needs an audio track).
  useEffect(() => {
    if (on) { stop(); start(); }
  }, [mode]);

  async function thumbnail(blob: Blob): Promise<string> {
    try {
      const small = await imageCompression(new File([blob], 'thumb', { type: blob.type }), {
        maxWidthOrHeight: 320, maxSizeMB: 0.05, useWebWorker: true,
      });
      return await imageCompression.getDataUrlFromFile(small);
    } catch { return ''; }
  }

  async function capturePhoto() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy('photo');
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    const raw: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.95));
    // Client-side compression before local persist.
    const blob: Blob = await imageCompression(new File([raw], 'photo.jpg', { type: 'image/jpeg' }), {
      maxWidthOrHeight: 1600, maxSizeMB: 1, useWebWorker: true,
    });
    const thumb = await thumbnail(blob);
    // Best-effort local OCR — never blocks the capture.
    let ocrText = '';
    try {
      setBusy('ocr');
      const Tesseract = (await import('tesseract.js')).default;
      const { data } = await Tesseract.recognize(blob, 'eng');
      ocrText = (data.text || '').trim();
    } catch { /* OCR optional */ }
    await putCapture(
      {
        kind: 'photo', mimeType: 'image/jpeg', byteSize: blob.size, width: canvas.width, height: canvas.height,
        ...(ocrText ? { ocrText } : {}), ...(thumb ? { thumbnailDataUrl: thumb } : {}),
        provenance: { tool: 'camera', version: '1.0.0', model: 'tesseract-eng-local' },
      },
      blob,
    );
    setBusy(null);
    setNote('Photo captured — quarantined locally. Review it below.');
    setTimeout(() => setNote(null), 3600);
    setRefreshKey((k) => k + 1);
  }

  function startVideo() {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const mr = new MediaRecorder(stream, { mimeType: mime });
    chunksRef.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setBusy('video');
      await putCapture(
        { kind: 'video', mimeType: 'video/webm', byteSize: blob.size, provenance: { tool: 'camera', version: '1.0.0' } },
        blob,
      );
      setBusy(null);
      setNote('Video captured — quarantined locally. Review it below.');
      setTimeout(() => setNote(null), 3600);
      setRefreshKey((k) => k + 1);
    };
    mr.start();
    recorderRef.current = mr;
    setRecording(true);
  }
  function stopVideo() { recorderRef.current?.stop(); setRecording(false); }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-3xl mx-auto w-full">
      <div className="flex items-center gap-2">
        <button onClick={() => setMode('photo')} className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
          style={mode === 'photo' ? { backgroundColor: 'var(--color-steel)', color: 'white', borderColor: 'var(--color-steel)' } : { borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
          <CameraIcon className="inline w-3.5 h-3.5 mr-1" /> Photo
        </button>
        <button onClick={() => setMode('video')} className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
          style={mode === 'video' ? { backgroundColor: 'var(--color-steel)', color: 'white', borderColor: 'var(--color-steel)' } : { borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>
          <Video className="inline w-3.5 h-3.5 mr-1" /> Video
        </button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--color-warm-gray)' }}>Private · stored on this device only</span>
      </div>

      <div className="rounded-xl overflow-hidden border bg-black aspect-video flex items-center justify-center" style={{ borderColor: 'var(--color-border)' }}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" style={{ display: on ? 'block' : 'none' }} />
        {!on && <span className="text-xs text-white/70">Camera is off</span>}
      </div>

      {note && <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}>{note}</div>}

      <div className="flex items-center gap-2">
        {!on ? (
          <button onClick={start} className="text-sm font-semibold px-4 py-2 rounded-xl text-white" style={{ backgroundColor: 'var(--color-steel)' }}>Start camera</button>
        ) : (
          <>
            {mode === 'photo' && (
              <button onClick={capturePhoto} disabled={!!busy} className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50 inline-flex items-center gap-2" style={{ backgroundColor: 'var(--color-steel)' }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CameraIcon className="w-4 h-4" />}
                {busy === 'ocr' ? 'Reading text…' : busy === 'photo' ? 'Saving…' : 'Capture photo'}
              </button>
            )}
            {mode === 'video' && !recording && (
              <button onClick={startVideo} className="text-sm font-semibold px-4 py-2 rounded-xl text-white inline-flex items-center gap-2" style={{ backgroundColor: '#b3261e' }}><Video className="w-4 h-4" /> Record</button>
            )}
            {mode === 'video' && recording && (
              <button onClick={stopVideo} className="text-sm font-semibold px-4 py-2 rounded-xl text-white inline-flex items-center gap-2" style={{ backgroundColor: '#b3261e' }}><Square className="w-4 h-4" /> Stop</button>
            )}
            <button onClick={stop} className="text-sm font-medium px-4 py-2 rounded-xl border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-navy-mid)' }}>Stop camera</button>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-warm-gray)' }}><ScanText className="w-3.5 h-3.5" /> OCR runs locally on photos</span>
          </>
        )}
      </div>

      <CameraCaptures key={refreshKey} />
    </div>
  );
}
