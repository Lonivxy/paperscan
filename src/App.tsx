import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, SyntheticEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  FileText,
  Flashlight,
  Image as ImageIcon,
  Keyboard,
  LoaderCircle,
  Settings2,
  Vibrate,
  Volume2,
} from "lucide-react";
import { animate, motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { PaperLibrary } from "@/components/paper-library";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/arc/tabs/tabs";
import { cleanBarcode, parseBarcode, prepareScanResultTarget } from "@/lib/barcode.js";
import type { PaperIndex } from "@/lib/papers";
import type { PaperScanState, PaperScanWrite } from "@/lib/paper-store.types";

type Mode = "camera" | "input" | "photo";
type AppView = "scan" | "library";
type Notice = {
  tone: "info" | "success" | "warning" | "danger";
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
};
type ScanResult = { getText: () => string };
type ScanControls = { stop: () => void };
type BarcodeReader = {
  decodeFromConstraints: (
    constraints: MediaStreamConstraints,
    video: HTMLVideoElement,
    callback: (result?: ScanResult | null, error?: unknown, controls?: ScanControls) => void,
  ) => Promise<ScanControls>;
  decodeFromImageUrl: (url: string) => Promise<ScanResult>;
};

declare global {
  interface Window {
    ZXingBrowser?: {
      BrowserMultiFormatOneDReader: new (hints?: Map<number, boolean>) => BarcodeReader;
    };
  }
}

const siteRoot = new URL(import.meta.env.BASE_URL, window.location.href);

/** Rolling numeral: new index counts settle up into place (Amicro-style reveal). */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (current) => setDisplay(Math.round(current)),
    });
    return () => controls.stop();
  }, [value, reduced]);
  return <>{display.toLocaleString()}</>;
}

async function loadBarcodeReader() {
  if (!window.ZXingBrowser) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("vendor/zxing.min.js", siteRoot).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("ZXing could not be loaded"));
      document.head.append(script);
    });
  }
  if (!window.ZXingBrowser) throw new Error("ZXing could not be loaded");
  return new window.ZXingBrowser.BrowserMultiFormatOneDReader(new Map([[3, true]]));
}

function App() {
  const [view, setView] = useState<AppView>("scan");
  const [mode, setMode] = useState<Mode>("camera");
  const [papers, setPapers] = useState<PaperIndex["papers"]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [indexState, setIndexState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [code, setCode] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [savedState, setSavedState] = useState<PaperScanState>(() => window.PaperScanStore.get());
  const [storageWarning, setStorageWarning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [photoState, setPhotoState] = useState<"idle" | "busy" | "done">("idle");
  const [copiedExample, setCopiedExample] = useState(false);
  const [subjectsOpen, setSubjectsOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<ScanControls | null>(null);
  const scanSessionRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const startScanRef = useRef<() => void>(() => {});
  const exampleTimerRef = useRef<number | undefined>(undefined);

  const applyStoreWrite = useCallback((write: PaperScanWrite) => {
    setSavedState(write.state);
    setStorageWarning(!write.persisted);
  }, []);

  const ensureAudioContext = useCallback(() => {
    try {
      const Context = window.AudioContext;
      if (!Context) return null;
      const context = audioContextRef.current ?? new Context();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();
      return context;
    } catch {
      return null;
    }
  }, []);

  const playScanFeedback = useCallback(() => {
    const { sound, vibration } = window.PaperScanStore.get().feedback;
    if (vibration) navigator.vibrate?.([45, 45, 80]);
    if (!sound) return;
    // The context is created/resumed in the tap handler; creating it here, in
    // the async decode callback, leaves iOS Safari with a suspended context.
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;
    try {
      const start = context.currentTime;
      for (const [frequency, offset] of [[880, 0], [1174, 0.09]] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start + offset);
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.11, start + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.12);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 0.13);
      }
    } catch {
      // Sound is optional; a restricted browser should not block lookup.
    }
  }, []);

  const focusManualEntry = useCallback(() => {
    setView("scan");
    setMode("input");
    window.setTimeout(() => document.getElementById("barcode-input")?.focus(), 0);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(new URL("papers.json", siteRoot), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("The index request failed");
        return response.json() as Promise<PaperIndex>;
      })
      .then((index) => {
        setPapers(index.papers);
        setSubjects(index.subjects ?? []);
        setIndexState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setIndexState("error");
      });
    return () => controller.abort();
  }, []);

  const stopScan = useCallback(() => {
    scanSessionRef.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  useEffect(() => {
    if (mode !== "camera") stopScan();
  }, [mode, stopScan]);

  useEffect(() => {
    const refreshSavedState = () => setSavedState(window.PaperScanStore.get());
    window.addEventListener("pageshow", refreshSavedState);
    window.addEventListener("storage", refreshSavedState);
    return () => {
      if (exampleTimerRef.current !== undefined) window.clearTimeout(exampleTimerRef.current);
      window.removeEventListener("pageshow", refreshSavedState);
      window.removeEventListener("storage", refreshSavedState);
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  // Keep the mount-time auto-scan wired to the latest openResult closure, so a
  // valid scan after the index loads is not treated as "index still loading".
  useEffect(() => {
    startScanRef.current = startScan;
  });

  useEffect(() => {
    const onPageHide = () => stopScan();
    const onVisibility = () => {
      if (document.hidden) stopScan();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    let autoScanTimer: number | undefined;
    if (new URLSearchParams(window.location.search).get("scan") === "1") {
      autoScanTimer = window.setTimeout(() => startScanRef.current(), 100);
    }
    return () => {
      if (autoScanTimer !== undefined) window.clearTimeout(autoScanTimer);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      stopScan();
    };
  }, [stopScan]);

  useEffect(() => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    navigator.serviceWorker?.register(new URL("sw.js", base), { scope: base.pathname }).catch(() => {});
  }, []);

  const openResult = useCallback((raw: string, options?: { record?: boolean; feedback?: boolean; silent?: boolean }) => {
    const { barcode, cleaned, resultHref } = prepareScanResultTarget(raw, window.location.href);
    setCode(cleaned);
    setView("scan");
    if (!barcode || !resultHref) {
      setMode("input");
      setNotice({
        tone: "warning",
        title: "Check the code",
        detail: cleaned ? `Kept “${cleaned}” in the field. Edit it and try again.` : "Enter the full code, e.g. P61109A.",
        action: { label: "Edit code", onClick: focusManualEntry },
      });
      return;
    }
    // Opening a paper from the library is browsing, not a scan.
    if (options?.record !== false) {
      applyStoreWrite(window.PaperScanStore.recordScan(cleaned, barcode));
    }
    if (options?.feedback) playScanFeedback();
    if (indexState === "loading") {
      setNotice({ tone: "info", title: "Loading the paper index", detail: "Try again in a moment." });
      return;
    }
    if (indexState === "error") {
      setNotice({ tone: "danger", title: "Paper index unavailable", detail: "Connect to the internet and refresh." });
      return;
    }
    if (!papers.some((paper) => paper.code === barcode.code)) {
      setMode("input");
      setNotice({
        tone: "info",
        title: `Not in the index: ${barcode.code}`,
        detail: "Kept the code. Edit it and retry, or find the paper in the library.",
        action: { label: "Edit code", onClick: focusManualEntry },
      });
      return;
    }
    if (!options?.silent) {
      setNotice({ tone: "success", title: "Barcode found", detail: "Opening the paper." });
    }
    const shell = document.querySelector(".app-shell");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !shell) {
      window.location.assign(resultHref);
      return;
    }
    shell.classList.add("page-leaving");
    window.setTimeout(() => window.location.assign(resultHref), 220);
  }, [applyStoreWrite, focusManualEntry, indexState, papers, playScanFeedback]);

  async function startScan() {
    stopScan();
    // Unlock audio inside the tap that starts the camera; iOS Safari keeps a
    // context created later, in the decode callback, suspended.
    ensureAudioContext();
    const session = scanSessionRef.current;
    setMode("camera");
    setNotice({ tone: "info", title: "Starting the camera", detail: "Allow PaperScan to use the camera." });
    setCameraActive(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) throw new Error("Camera unavailable");
      const reader = await loadBarcodeReader();
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoRef.current,
        (result, _error, callbackControls) => {
          if (scanSessionRef.current !== session) {
            callbackControls?.stop();
            return;
          }
          if (!result) return;
          const text = result.getText();
          if (parseBarcode(text)) {
            callbackControls?.stop();
            stopScan();
            openResult(text, { feedback: true });
          } else {
            const readText = cleanBarcode(text).slice(0, 30);
            setNotice({
              tone: "warning",
              title: "That's a different barcode",
              detail: readText ? `Read “${readText}”. Point at a paper code that starts with P.` : "Point at a paper code that starts with P.",
              action: readText
                ? { label: "Edit code", onClick: () => { setCode(readText); focusManualEntry(); } }
                : undefined,
            });
          }
        },
      );
      if (scanSessionRef.current !== session) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      const stream = videoRef.current?.srcObject;
      const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
      const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchSupported(capabilities?.torch === true);
      setNotice({ tone: "info", title: "Scanning", detail: "Center the full barcode from the bottom of the page." });
    } catch (error) {
      stopScan();
      const name = error instanceof Error ? error.name : "";
      setNotice({
        tone: "danger",
        title: name === "NotAllowedError" ? "Camera access is off" : "Camera unavailable",
        detail: name === "NotAllowedError"
          ? "Allow the camera in browser settings, or use Code or Photo."
          : "Use Code or Photo instead. The camera needs HTTPS.",
        action: { label: "Enter code", onClick: focusManualEntry },
      });
    }
  }

  async function toggleTorch() {
    const stream = videoRef.current?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setNotice({ tone: "warning", title: "Torch unavailable", detail: "This browser or camera can't switch the light." });
    }
  }

  function openLibrary() {
    stopScan();
    setView("library");
    setNotice(null);
    window.scrollTo(0, 0);
  }

  function returnToScanner() {
    setView("scan");
    window.scrollTo(0, 0);
  }

  function toggleFavorite(codeToToggle: string) {
    applyStoreWrite(window.PaperScanStore.toggleFavorite(codeToToggle));
  }

  function updateFeedback(patch: Partial<PaperScanState["feedback"]>) {
    if (patch.sound) ensureAudioContext();
    applyStoreWrite(window.PaperScanStore.setFeedback(patch));
  }

  function clearHistory() {
    applyStoreWrite(window.PaperScanStore.clearHistory());
    setClearHistoryOpen(false);
  }

  function submitBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openResult(code);
  }

  // Arc's tab height morph can leave an inline height on the panel when content
  // grows mid-transition; release it so an expanded list can't overlap the page below.
  // Scope to the panel that contains the control: Arc keeps the outgoing panel
  // mounted during a tab morph, so a document-wide lookup can target the wrong one.
  function releaseTabPanelHeight(event: SyntheticEvent<HTMLElement>) {
    const panel = event.currentTarget.closest<HTMLElement>('[role="tabpanel"]');
    if (!panel) return;
    requestAnimationFrame(() => {
      panel.style.height = "";
      panel.style.overflow = "";
    });
  }

  function showExample() {
    setCode("P61109A");
    setCopiedExample(true);
    setNotice({ tone: "info", title: "Example code filled in", detail: "Tap Find paper to open it." });
    if (exampleTimerRef.current !== undefined) window.clearTimeout(exampleTimerRef.current);
    exampleTimerRef.current = window.setTimeout(() => {
      exampleTimerRef.current = undefined;
      setCopiedExample(false);
    }, 2000);
  }

  async function recognizePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice(null);
    setPhotoState("busy");
    try {
      const reader = await loadBarcodeReader();
      const imageUrl = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(imageUrl);
        const text = result.getText();
        const barcode = parseBarcode(text);
        const known =
          barcode !== null &&
          indexState === "ready" &&
          papers.some((paper) => paper.code === barcode.code);
        if (known) {
          // Let the button settle on its checkmark before the result page opens.
          setPhotoState("done");
          await new Promise((resolve) => window.setTimeout(resolve, 650));
        } else {
          setPhotoState("idle");
        }
        // The button itself already confirms success; skip the duplicate alert.
        openResult(text, { silent: known, feedback: true });
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    } catch {
      setPhotoState("idle");
      setNotice({
        tone: "warning",
        title: "No clear barcode found",
        detail: "Crop closer to the barcode, or enter the code.",
      });
    } finally {
      event.target.value = "";
    }
  }

  const reduced = useReducedMotion();
  // Amicro-style entrance: rise, unblur, settle — one staggered pass on load, disabled for reduced motion.
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
      : {
          initial: { opacity: 0, y: 14, filter: "blur(6px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
        };

  const noticeView = notice ? (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: -6, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, filter: "blur(2px)", transition: { duration: 0.14 } }}
      transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.35, bounce: 0 }}
    >
      <Alert tone={notice.tone} title={notice.title} open>
        <div className="notice-copy">
          {notice.detail ? <p>{notice.detail}</p> : null}
          {notice.action ? (
            <Button className="notice-action" variant="secondary" size="sm" onClick={notice.action.onClick}>
              {notice.action.label}
            </Button>
          ) : null}
        </div>
      </Alert>
    </motion.div>
  ) : null;

  const viewMotion = reduced
    ? {
        initial: false as const,
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: { duration: 0 } },
      }
    : {
        initial: { opacity: 0, y: 16, filter: "blur(6px)" },
        animate: { opacity: 1, y: 0, filter: "blur(0px)" },
        exit: { opacity: 0, y: -8, filter: "blur(4px)", transition: { duration: 0.16 } },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
      };

  return (
    <main className={`app-shell${view === "library" ? " app-shell-library" : ""}`}>
      {/* M3 Small Top App Bar */}
      <motion.header className="site-header" {...rise(0)}>
        <a className="brand" href={siteRoot.href} aria-label="PaperScan home">
          <img src={new URL("icon.svg", siteRoot).href} alt="" width="32" height="32" className="brand-icon" />
          <span className="brand-title">PaperScan</span>
        </a>
        <div className="header-actions">
          <Button
            className="library-action"
            variant={view === "library" ? "secondary" : "ghost"}
            size="sm"
            aria-label={view === "library" ? "Back to scanner" : "Paper library"}
            onClick={view === "library" ? returnToScanner : openLibrary}
          >
            {view === "library" ? <Camera size={17} aria-hidden="true" /> : <BookOpen size={17} aria-hidden="true" />}
            <span>{view === "library" ? "Scan" : "Library"}</span>
          </Button>
          <Button
            className="install-action"
            variant="ghost"
            size="sm"
            aria-label="Install PaperScan"
            onClick={() => setInstallOpen(true)}
          >
            <span>Install</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Button>
        </div>
      </motion.header>

      {/* Main Content Area */}
      <section
        className={`home-content${view === "library" ? " library-content" : ""}`}
        aria-labelledby={view === "library" ? "library-title" : "hero-title"}
      >
        <AnimatePresence mode="popLayout" initial={false}>
        {view === "library" ? (
          <motion.div key="library" className="view-shell" {...viewMotion}>
            <PaperLibrary
              papers={papers}
              saved={savedState}
              indexState={indexState}
              storageWarning={storageWarning}
              onBack={returnToScanner}
              onOpenBarcode={(barcode) => openResult(barcode, { record: false })}
              onToggleFavorite={toggleFavorite}
              onClearHistory={() => setClearHistoryOpen(true)}
            />
          </motion.div>
        ) : (
        <motion.div key="scan" className="view-shell" {...viewMotion}>
        <div className="hero-copy">
          {/* Amicro-style text reveal: each phrase rises out of a blur in turn. */}
          <h1 id="hero-title" aria-label="Scan. Open. Done.">
            {["Scan.", "Open.", "Done."].map((phrase, index) => (
              <motion.span
                key={phrase}
                className="hero-phrase"
                aria-hidden="true"
                initial={reduced ? false : { opacity: 0, y: "0.3em", filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.65, delay: 0.06 + index * 0.09, ease: [0.16, 1, 0.3, 1] }
                }
              >
                {phrase}
              </motion.span>
            ))}
          </h1>
          <motion.p className="hero-lede" {...rise(0.22)}>
            Point at the barcode at the bottom of any past paper.
          </motion.p>
        </div>

        {/* M3 Primary Tabs */}
        <motion.div className="capture-section" {...rise(0.14)}>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            setNotice(null);
            setMode(value as Mode);
          }}
          className="capture-tabs"
        >
          <TabsList aria-label="Choose scan mode">
            <TabsTrigger value="camera">
              <Camera size={18} aria-hidden="true" />
              <span>Camera</span>
            </TabsTrigger>
            <TabsTrigger value="input">
              <Keyboard size={18} aria-hidden="true" />
              <span>Code</span>
            </TabsTrigger>
            <TabsTrigger value="photo">
              <ImageIcon size={18} aria-hidden="true" />
              <span>Photo</span>
            </TabsTrigger>
          </TabsList>

          {/* Camera Tab Content */}
          <TabsContent value="camera" className="capture-panel-slot">
            <section
              className={`scan-panel${cameraActive ? " is-scanning" : ""}`}
              aria-label="Barcode scanner"
            >
              <div className="scan-tools" aria-label="Scan settings">
                {cameraActive && torchSupported ? (
                  <Button
                    className="scan-tool"
                    variant={torchOn ? "primary" : "secondary"}
                    size="sm"
                    aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
                    aria-pressed={torchOn}
                    onClick={toggleTorch}
                  >
                    <Flashlight size={18} aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  className="scan-tool"
                  variant="secondary"
                  size="sm"
                  aria-label="Scan feedback settings"
                  onClick={() => setFeedbackOpen(true)}
                >
                  <Settings2 size={18} aria-hidden="true" />
                </Button>
              </div>
              <video ref={videoRef} className="camera-feed" muted playsInline aria-label="Camera preview" />

              {/* M3 Clean Viewfinder Reticle */}
              <div className="viewfinder-container" aria-hidden="true">
                <svg className="scan-frame" viewBox="0 0 360 360" preserveAspectRatio="none">
                  <path
                    d="M32 62V40H54 M328 62V40H306 M32 298V320H54 M328 298V320H306"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* A single light sweep while the camera is live. */}
              {cameraActive ? <div className="scan-line" aria-hidden="true" /> : null}

              {/* One instruction, only while the camera is live. */}
              {cameraActive ? (
                <div className="scan-prompt" aria-live="polite">
                  <p className="prompt-text">Center the full barcode</p>
                </div>
              ) : null}

              {/* M3 Extended Floating Action Button (FAB) */}
              <div className="scan-action-wrapper">
                <Button
                  className="scan-action"
                  variant="primary"
                  size="lg"
                  onClick={cameraActive ? stopScan : startScan}
                >
                  {cameraActive ? (
                    <>
                      <LoaderCircle size={22} className="button-spinner" aria-hidden="true" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Camera size={22} aria-hidden="true" />
                      <span>Open camera</span>
                    </>
                  )}
                </Button>
              </div>
            </section>
            <div className="notice-slot">{noticeView}</div>
          </TabsContent>

          {/* Manual Input Tab Content */}
          <TabsContent value="input" className="capture-panel-slot">
            <section className="mode-panel mode-panel-light" aria-label="Enter paper code">
              <form className="lookup-form" onSubmit={submitBarcode}>
                <div className="input-field-wrapper">
                  <Input
                    id="barcode-input"
                    label="Paper code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={30}
                    required
                  />
                </div>
                <Button className="lookup-action" variant="primary" type="submit">
                    <span>Find paper</span>
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </Button>
              </form>

              {/* M3 Assist Chip — AnimatePresence crossfades the check icon */}
              <div className="chips-row">
                <motion.button
                  type="button"
                  className="assist-chip"
                  onClick={showExample}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 450, damping: 30 }}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {copiedExample ? (
                      <motion.span
                        key="check"
                        style={{ display: "inline-flex" }}
                        initial={reduced ? false : { opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 28 }}
                      >
                        <Check size={14} className="chip-icon-active" aria-hidden="true" />
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                  <span>Example P61109A</span>
                </motion.button>
              </div>

              {/* Spring-animated subjects accordion — replaces native <details> */}
              <div className="subjects-details">
                <button
                  type="button"
                  className="subjects-summary"
                  aria-expanded={subjectsOpen}
                  onClick={(event) => { setSubjectsOpen((o) => !o); releaseTabPanelHeight(event); }}
                >
                  <span>Supported subjects</span>
                  <motion.span
                    animate={{ rotate: subjectsOpen ? 180 : 0 }}
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 30 }}
                    style={{ display: "inline-flex" }}
                  >
                    <ChevronDown size={15} className="details-chevron" aria-hidden="true" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {subjectsOpen && (
                    <motion.div
                      className="subjects-list"
                      key="subjects"
                      initial={reduced ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 340, damping: 34 }}
                      style={{ overflow: "hidden" }}
                    >
                      {subjects.map((s) => (
                        <span key={s} className="subject-chip">{s}</span>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="notice-slot">{noticeView}</div>
            </section>
          </TabsContent>

          {/* Photo Import Tab Content */}
          <TabsContent value="photo" className="capture-panel-slot">
            <section className="photo-upload" aria-label="From photo">
              <input
                ref={photoRef}
                className="visually-hidden"
                type="file"
                accept="image/*"
                onChange={recognizePhoto}
                tabIndex={-1}
                aria-hidden="true"
              />

              <Button
                className="photo-action"
                variant="primary"
                size="lg"
                loading={photoState === "busy"}
                disabled={photoState === "done"}
                data-photo={photoState}
                onClick={() => photoRef.current?.click()}
              >
                {photoState === "done" ? (
                  <>
                    <Check size={20} aria-hidden="true" />
                    <span>Found</span>
                  </>
                ) : (
                  <>
                    <ImageIcon size={20} aria-hidden="true" />
                    <span>Choose photo</span>
                  </>
                )}
              </Button>

              <p className="visually-hidden" aria-live="polite">
                {photoState === "busy"
                  ? "Reading the photo"
                  : photoState === "done"
                    ? "Barcode found, opening the paper"
                    : ""}
              </p>

              <div className="notice-slot">{noticeView}</div>
            </section>
          </TabsContent>
        </Tabs>
        </motion.div>

        {/* One quiet line: coverage + source */}
        <motion.section className="meta-block" aria-label="Paper index coverage" {...rise(0.22)}>
          <div className="meta-line">
            <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
            {indexState === "loading" ? (
              <Skeleton className="coverage-skeleton" label="Loading the paper index" lines={1} />
            ) : indexState === "error" ? (
              <span>The paper index can&apos;t load. Refresh when online.</span>
            ) : (
              <span>
                <strong><CountUp value={papers.length} /></strong> IGCSE / IAL papers · {subjects.length} subjects
              </span>
            )}
            <a
              className="meta-link"
              href="https://www.paperlords.org/igcse"
              target="_blank"
              rel="noopener noreferrer"
            >
              PaperLords
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </div>
        </motion.section>
        </motion.div>
        )}
        </AnimatePresence>
      </section>

      {/* Install Dialog */}
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent title="Add to Home Screen" description="Open PaperScan from your home screen next time.">
          <ol className="install-steps">
            <li>Open the Share menu in your browser.</li>
            <li>Choose Add to Home Screen.</li>
            <li>Tap Add to finish.</li>
          </ol>
          <p className="install-hint">Menu names vary by browser and system.</p>
        </DialogContent>
      </Dialog>

      {/* Scan feedback settings */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent title="Scan feedback" description="Choose what happens when a barcode is read. Stored on this device.">
          <div className="feedback-settings">
            <div className="feedback-option" onClick={() => updateFeedback({ sound: !savedState.feedback.sound })}>
              <span>
                <Volume2 size={19} aria-hidden="true" />
                <span>
                  <strong>Sound</strong>
                  <small id="feedback-sound-desc">Play a short chime</small>
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-label="Sound"
                aria-describedby="feedback-sound-desc"
                aria-checked={savedState.feedback.sound}
                className="arc-switch"
                onClick={(event) => {
                  event.stopPropagation();
                  updateFeedback({ sound: !savedState.feedback.sound });
                }}
              >
                <motion.span
                  className="arc-switch-thumb"
                  animate={{ x: savedState.feedback.sound ? 20 : 0 }}
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 }}
                />
              </button>
            </div>
            <div className="feedback-option" onClick={() => updateFeedback({ vibration: !savedState.feedback.vibration })}>
              <span>
                <Vibrate size={19} aria-hidden="true" />
                <span>
                  <strong>Vibration</strong>
                  <small id="feedback-vibration-desc">A brief pulse where supported</small>
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-label="Vibration"
                aria-describedby="feedback-vibration-desc"
                aria-checked={savedState.feedback.vibration}
                className="arc-switch"
                onClick={(event) => {
                  event.stopPropagation();
                  updateFeedback({ vibration: !savedState.feedback.vibration });
                }}
              >
                <motion.span
                  className="arc-switch-thumb"
                  animate={{ x: savedState.feedback.vibration ? 20 : 0 }}
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 36 }}
                />
              </button>
            </div>
            <p className="feedback-hint">The torch control appears only when the camera supports it.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear scan history */}
      <Dialog open={clearHistoryOpen} onOpenChange={setClearHistoryOpen}>
        <DialogContent title="Clear scan history?" description="This removes recent scans from this device. Favorites are kept.">
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setClearHistoryOpen(false)}>Keep history</Button>
            <Button variant="danger" onClick={clearHistory}>Clear history</Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default App;
