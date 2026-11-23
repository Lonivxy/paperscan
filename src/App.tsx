import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, SyntheticEvent } from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Keyboard,
  LoaderCircle,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/arc/tabs/tabs";
import { normalizeBarcode, parseBarcode } from "@/lib/barcode.js";

type Mode = "camera" | "input" | "photo";
type Notice = { tone: "info" | "success" | "warning" | "danger"; title: string; detail?: string };
type Paper = { code: string };
type PaperIndex = { papers: Paper[]; subjects: string[]; updated: string };
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
  const [mode, setMode] = useState<Mode>("camera");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [indexState, setIndexState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [code, setCode] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [photoState, setPhotoState] = useState<"idle" | "busy" | "done">("idle");
  const [copiedExample, setCopiedExample] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<ScanControls | null>(null);
  const scanSessionRef = useRef(0);

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
  }, []);

  useEffect(() => {
    if (mode !== "camera") stopScan();
  }, [mode, stopScan]);

  useEffect(() => {
    const onPageHide = () => stopScan();
    const onVisibility = () => {
      if (document.hidden) stopScan();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    let autoScanTimer: number | undefined;
    if (new URLSearchParams(window.location.search).get("scan") === "1") {
      autoScanTimer = window.setTimeout(() => startScan(), 100);
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

  const openResult = useCallback((raw: string, options?: { silent?: boolean }) => {
    const barcode = parseBarcode(raw);
    if (!barcode) {
      setNotice({ tone: "warning", title: "Check the code", detail: "Enter the full code, e.g. P61109A." });
      return;
    }
    if (indexState === "loading") {
      setNotice({ tone: "info", title: "Loading the paper index", detail: "Try again in a moment." });
      return;
    }
    if (indexState === "error") {
      setNotice({ tone: "danger", title: "Paper index unavailable", detail: "Connect to the internet and refresh." });
      return;
    }
    const cleaned = String(raw).toUpperCase().replace(/[\s*]/g, "");
    setCode(cleaned);
    if (!papers.some((paper) => paper.code === barcode.code)) {
      setNotice({
        tone: "info",
        title: `Not in the index: ${barcode.code}`,
        detail: "Look it up on PaperLords or Pearson.",
      });
      return;
    }
    if (!options?.silent) {
      setNotice({ tone: "success", title: "Barcode found", detail: "Opening the paper." });
    }
    const resultUrl = new URL("result.html", window.location.href);
    resultUrl.searchParams.set("barcode", cleaned);
    const shell = document.querySelector(".app-shell");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !shell) {
      window.location.assign(resultUrl.href);
      return;
    }
    shell.classList.add("page-leaving");
    window.setTimeout(() => window.location.assign(resultUrl.href), 220);
  }, [indexState, papers]);

  async function startScan() {
    stopScan();
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
          if (normalizeBarcode(text)) {
            callbackControls?.stop();
            stopScan();
            openResult(text);
          } else {
            setNotice({
              tone: "warning",
              title: "That's a different barcode",
              detail: "Point at a paper code that starts with P.",
            });
          }
        },
      );
      if (scanSessionRef.current !== session) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
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
      });
    }
  }

  function submitBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openResult(code);
  }

  // Arc's tab height morph can leave an inline height on the panel when content
  // grows mid-transition; release it so an expanded list can't overlap the page below.
  function releaseTabPanelHeight(event: SyntheticEvent<HTMLDetailsElement>) {
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
    window.setTimeout(() => setCopiedExample(false), 2000);
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
        openResult(text, { silent: known });
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
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Alert tone={notice.tone} title={notice.title} open>
        {notice.detail}
      </Alert>
    </motion.div>
  ) : null;

  return (
    <main className="app-shell">
      {/* M3 Small Top App Bar */}
      <motion.header className="site-header" {...rise(0)}>
        <a className="brand" href={siteRoot.href} aria-label="PaperScan home">
          <img src={new URL("icon.svg", siteRoot).href} alt="" width="32" height="32" className="brand-icon" />
          <span className="brand-title">PaperScan</span>
        </a>
        <Button
          className="install-action"
          variant="ghost"
          size="sm"
          onClick={() => setInstallOpen(true)}
        >
          <span>Install</span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </Button>
      </motion.header>

      {/* Main Content Area */}
      <section className="home-content" aria-labelledby="hero-title">
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

              {/* One instruction, only while the camera is live. */}
              {cameraActive ? (
                <div className="scan-prompt" aria-live="polite">
                  <p className="prompt-text">Center the full barcode</p>
                </div>
              ) : null}

              {/* M3 Extended Floating Action Button (FAB) */}
              <motion.div
                className="scan-action-wrapper"
                whileTap={{ scale: 0.98 }}
                transition={{ type: "spring", stiffness: 450, damping: 30 }}
              >
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
              </motion.div>
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
                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button className="lookup-action" variant="primary" type="submit">
                    <span>Find paper</span>
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </Button>
                </motion.div>
              </form>

              {/* M3 Assist Chip */}
              <div className="chips-row">
                <motion.button
                  type="button"
                  className="assist-chip"
                  onClick={showExample}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 450, damping: 30 }}
                >
                  {copiedExample ? (
                    <Check size={14} className="chip-icon-active" aria-hidden="true" />
                  ) : null}
                  <span>Example P61109A</span>
                </motion.button>
              </div>

              {/* Clean M3 Subjects Details */}
              <details className="subjects-details" onToggle={releaseTabPanelHeight}>
                <summary>
                  <span>Supported subjects</span>
                  <ChevronDown size={15} className="details-chevron" aria-hidden="true" />
                </summary>
                <div className="subjects-list">
                  {subjects.map((s) => (
                    <span key={s} className="subject-chip">{s}</span>
                  ))}
                </div>
              </details>

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
                <strong>{papers.length.toLocaleString()}</strong> IGCSE / IAL papers · {subjects.length} subjects
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
    </main>
  );
}

export default App;
