import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Keyboard,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
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
  const [updated, setUpdated] = useState("");
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
        setUpdated(index.updated);
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
      setNotice({ tone: "warning", title: "请检查条码", detail: "输入完整条码，例如 P61109A。" });
      return;
    }
    if (indexState === "loading") {
      setNotice({ tone: "info", title: "试卷索引正在载入", detail: "请稍候再试。" });
      return;
    }
    if (indexState === "error") {
      setNotice({ tone: "danger", title: "试卷索引暂时无法载入", detail: "请联网后刷新页面。" });
      return;
    }
    const cleaned = String(raw).toUpperCase().replace(/[\s*]/g, "");
    setCode(cleaned);
    if (!papers.some((paper) => paper.code === barcode.code)) {
      setNotice({
        tone: "info",
        title: `暂未收录 ${barcode.code}`,
        detail: "可到 PaperLords 或 Pearson 目录查询。",
      });
      return;
    }
    if (!options?.silent) {
      setNotice({ tone: "success", title: "条码已识别", detail: "正在打开对应试卷。" });
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
    setNotice({ tone: "info", title: "正在开启相机", detail: "请允许 PaperScan 使用相机。" });
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
              title: "读到了其他条码",
              detail: "请对准以 P 开头的试卷条码。",
            });
          }
        },
      );
      if (scanSessionRef.current !== session) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      setNotice({ tone: "info", title: "正在扫描", detail: "将页面底部的完整条码放入取景框。" });
    } catch (error) {
      stopScan();
      const name = error instanceof Error ? error.name : "";
      setNotice({
        tone: "danger",
        title: name === "NotAllowedError" ? "相机权限未开启" : "无法启动相机",
        detail: name === "NotAllowedError"
          ? "请在浏览器设置中允许相机，或改用输入和照片识别。"
          : "请改用输入条码或从照片识别。相机需要安全的 HTTPS 页面。",
      });
    }
  }

  function submitBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openResult(code);
  }

  function showExample() {
    setCode("P61109A");
    setCopiedExample(true);
    setNotice({ tone: "info", title: "已填入示例条码", detail: "点击查找试卷查看对应试卷。" });
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
        title: "没有识别到清晰条码",
        detail: "可裁剪到条码附近，或改为手动输入。",
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
        <a className="brand" href={siteRoot.href} aria-label="PaperScan 首页">
          <img src={new URL("icon.svg", siteRoot).href} alt="" width="32" height="32" className="brand-icon" />
          <span className="brand-title">PaperScan</span>
        </a>
        <Button
          className="install-action"
          variant="ghost"
          size="sm"
          onClick={() => setInstallOpen(true)}
        >
          <span>添加到主屏幕</span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </Button>
      </motion.header>

      {/* Main Content Area */}
      <section className="home-content" aria-labelledby="hero-title">
        <div className="hero-copy">
          <motion.p className="hero-eyebrow" {...rise(0.02)}>
            <span className="hero-eyebrow-dot" aria-hidden="true" />
            Edexcel IGCSE · IAL
          </motion.p>
          {/* Amicro-style text reveal: each phrase rises out of a blur in turn. */}
          <h1 id="hero-title" aria-label="扫一下，打开试卷。">
            {["扫一下，", "打开试卷。"].map((phrase, index) => (
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
            对准页面底部的完整条码，快速打开真题与评分标准。
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
          <TabsList aria-label="选择识别方式">
            <TabsTrigger value="camera">
              <Camera size={18} aria-hidden="true" />
              <span>相机</span>
            </TabsTrigger>
            <TabsTrigger value="input">
              <Keyboard size={18} aria-hidden="true" />
              <span>输入条码</span>
            </TabsTrigger>
            <TabsTrigger value="photo">
              <ImageIcon size={18} aria-hidden="true" />
              <span>从照片识别</span>
            </TabsTrigger>
          </TabsList>

          {/* Camera Tab Content */}
          <TabsContent value="camera" className="capture-panel-slot">
            <section
              className={`scan-panel${cameraActive ? " is-scanning" : ""}`}
              aria-label="条码扫描器"
            >
              <video ref={videoRef} className="camera-feed" muted playsInline aria-label="相机预览" />

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

              {/* Viewfinder Prompt */}
              <div className="scan-prompt" aria-live="polite">
                <div className="prompt-glyph">
                  <Camera size={30} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <p className="prompt-text">
                  {cameraActive ? "将完整条码放入取景框" : "对准页面底部的完整条码"}
                </p>
              </div>

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
                      <span>停止扫描</span>
                    </>
                  ) : (
                    <>
                      <Camera size={22} aria-hidden="true" />
                      <span>开启相机扫描</span>
                    </>
                  )}
                </Button>
              </motion.div>
            </section>
            <div className="notice-slot">{noticeView}</div>
          </TabsContent>

          {/* Manual Input Tab Content */}
          <TabsContent value="input" className="capture-panel-slot">
            <section className="mode-panel mode-panel-light" aria-labelledby="barcode-title">
              <div className="mode-heading">
                <div className="mode-icon">
                  <Keyboard size={20} aria-hidden="true" />
                </div>
                <div>
                  <h2 id="barcode-title">输入试卷条码</h2>
                  <p>完整条码通常以 P 开头，位于试卷每页最底端。</p>
                </div>
              </div>

              <form className="lookup-form" onSubmit={submitBarcode}>
                <div className="input-field-wrapper">
                  <Input
                    id="barcode-input"
                    label="试卷条码"
                    placeholder="例如 P61109A"
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
                    <span>查找试卷</span>
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
                  ) : (
                    <Sparkles size={14} aria-hidden="true" />
                  )}
                  <span>试试示例 P61109A</span>
                </motion.button>
              </div>

              {/* Clean M3 Subjects Details */}
              <details className="subjects-details">
                <summary>
                  <span>查看支持的科目 ({subjects.length})</span>
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
            <section className="photo-upload" aria-labelledby="photo-title">
              <div className="photo-intro">
                <h2 id="photo-title">从照片识别</h2>
                <p>选择一张包含完整条码的试卷照片</p>
              </div>

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
                    <span>已识别</span>
                  </>
                ) : (
                  <>
                    <ImageIcon size={20} aria-hidden="true" />
                    <span>选择试卷照片</span>
                  </>
                )}
              </Button>

              <p className="visually-hidden" aria-live="polite">
                {photoState === "busy"
                  ? "正在识别照片"
                  : photoState === "done"
                    ? "条码已识别，正在打开试卷"
                    : ""}
              </p>

              <div className="notice-slot">{noticeView}</div>
            </section>
          </TabsContent>
        </Tabs>
        </motion.div>

        {/* Quiet metadata: coverage, freshness, privacy */}
        <motion.section className="meta-block" aria-label="试卷索引覆盖范围" {...rise(0.22)}>
          <div className="meta-line">
            <FileText size={16} strokeWidth={1.75} aria-hidden="true" />
            {indexState === "loading" ? (
              <Skeleton className="coverage-skeleton" label="正在载入试卷索引" lines={1} />
            ) : indexState === "error" ? (
              <span>试卷索引暂时无法载入，请联网后刷新。</span>
            ) : (
              <span>
                已收录 <strong>{papers.length.toLocaleString()}</strong> 份试卷 · {subjects.length} 个科目
              </span>
            )}
          </div>
          <div className="meta-line meta-sub">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>条码在本机识别，照片不会上传</span>
            {updated ? <span className="meta-date">更新 {updated}</span> : null}
          </div>
        </motion.section>
      </section>

      {/* Footer */}
      <motion.footer className="home-footer" {...rise(0.28)}>
        <div className="footer-left">
          <span>PaperScan</span>
          <span className="footer-dot">·</span>
          <span>Edexcel IGCSE & IAL</span>
        </div>
        <a
          href="https://www.paperlords.org/igcse"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          <span>试卷目录：PaperLords</span>
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </motion.footer>

      {/* Install Dialog */}
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent title="添加到主屏幕" description="下次从主屏幕即可快速打开 PaperScan 查题。">
          <ol className="install-steps">
            <li>在浏览器工具栏中打开「分享」菜单。</li>
            <li>在选项中选择「添加到主屏幕」。</li>
            <li>点击「添加」完成安装。</li>
          </ol>
          <p className="install-hint">菜单名称可能因浏览器与操作系统略有差异。</p>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default App;
