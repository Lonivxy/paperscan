import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  ArrowUpRight,
  Camera,
  FileText,
  Image as ImageIcon,
  Keyboard,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
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
  const [photoBusy, setPhotoBusy] = useState(false);
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

  const openResult = useCallback((raw: string) => {
    const barcode = parseBarcode(raw);
    if (!barcode) {
      setNotice({ tone: "warning", title: "请检查条码", detail: "输入完整条码，例如 P76186A0628。" });
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
    setNotice({ tone: "success", title: "条码已识别", detail: "正在打开对应试卷。" });
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
    setCode("P76186A0628");
    setNotice({ tone: "info", title: "已填入示例条码", detail: "点击查找试卷查看对应试卷。" });
  }

  async function recognizePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice({ tone: "info", title: "正在识别照片", detail: "请保持页面打开。" });
    setPhotoBusy(true);
    try {
      const reader = await loadBarcodeReader();
      const imageUrl = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(imageUrl);
        openResult(result.getText());
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    } catch {
      setNotice({
        tone: "warning",
        title: "没有识别到清晰条码",
        detail: "可裁剪到条码附近，或改为手动输入。",
      });
    } finally {
      setPhotoBusy(false);
      event.target.value = "";
    }
  }

  const noticeView = notice ? (
    <Alert tone={notice.tone} title={notice.title} open>
      {notice.detail}
    </Alert>
  ) : null;

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href={siteRoot.href} aria-label="PaperScan 首页">
          <img src={new URL("icon.svg", siteRoot).href} alt="" width="42" height="42" />
          <span>PaperScan</span>
        </a>
        <Button className="install-action" variant="ghost" size="sm" onClick={() => setInstallOpen(true)}>
          <span>添加到主屏幕</span>
          <ArrowUpRight size={17} strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </header>

      <section className="home-content" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">扫一下，打开试卷。</h1>
          <p>对准页面底部的完整条码</p>
        </div>

        <Tabs value={mode} onValueChange={(value) => { setNotice(null); setMode(value as Mode); }} className="capture-tabs">
          <TabsList aria-label="选择识别方式">
            <TabsTrigger value="camera"><Camera size={19} strokeWidth={1.8} aria-hidden="true" /><span>相机</span></TabsTrigger>
            <TabsTrigger value="input"><Keyboard size={19} strokeWidth={1.8} aria-hidden="true" /><span>输入条码</span></TabsTrigger>
            <TabsTrigger value="photo"><ImageIcon size={19} strokeWidth={1.8} aria-hidden="true" /><span>从照片识别</span></TabsTrigger>
          </TabsList>

          <TabsContent value="camera" className="capture-panel-slot">
            <section className={`scan-panel${cameraActive ? " is-scanning" : ""}`} aria-label="条码扫描器">
              <video ref={videoRef} className="camera-feed" muted playsInline aria-label="相机预览" />
              <svg className="scan-frame" viewBox="0 0 360 360" preserveAspectRatio="none" aria-hidden="true">
                <path
                  d="M32 62V40H54 M328 62V40H306 M32 230V252H54 M328 230V252H306"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="scan-prompt" aria-live="polite">
                <Camera size={52} strokeWidth={1.6} aria-hidden="true" />
                <p>{cameraActive ? "将完整条码放入取景框" : "对准页面底部的完整条码"}</p>
              </div>
              <Button
                className="scan-action"
                variant="primary"
                size="lg"
                onClick={cameraActive ? stopScan : startScan}
              >
                {cameraActive
                  ? <><LoaderCircle size={23} className="button-spinner" aria-hidden="true" />停止扫描</>
                  : <><Camera size={25} strokeWidth={1.9} aria-hidden="true" />开启相机扫描</>}
              </Button>
            </section>
            <div className="notice-slot">{noticeView}</div>
          </TabsContent>

          <TabsContent value="input" className="capture-panel-slot">
            <section className="mode-panel mode-panel-light" aria-labelledby="barcode-title">
              <div className="mode-heading">
                <span className="mode-icon"><Keyboard size={25} strokeWidth={1.8} aria-hidden="true" /></span>
                <div>
                  <h2 id="barcode-title">输入试卷条码</h2>
                  <p>完整条码通常以 P 开头。</p>
                </div>
              </div>
              <form className="lookup-form" onSubmit={submitBarcode}>
                <Input
                  id="barcode-input"
                  label="试卷条码"
                  placeholder="例如 P76186A0628"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={30}
                  required
                />
                <Button className="lookup-action" variant="primary" type="submit">
                  查找试卷 <ArrowUpRight size={17} aria-hidden="true" />
                </Button>
              </form>
              <Button className="example-action" variant="ghost" size="sm" onClick={showExample}>
                试试示例 P76186A0628
              </Button>
              <details className="subjects-details">
                <summary>查看支持的科目</summary>
                <p>{subjects.join("、")}</p>
              </details>
              <div className="notice-slot">{noticeView}</div>
            </section>
          </TabsContent>

          <TabsContent value="photo" className="capture-panel-slot">
            <section className="scan-panel photo-panel" aria-labelledby="photo-title">
              <div className="scan-prompt photo-prompt">
                {photoBusy
                  ? <LoaderCircle size={58} className="button-spinner" aria-hidden="true" />
                  : <ImageIcon size={58} strokeWidth={1.6} aria-hidden="true" />}
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
              <Button className="scan-action" variant="primary" size="lg" onClick={() => photoRef.current?.click()} disabled={photoBusy}>
                <ImageIcon size={24} strokeWidth={1.9} aria-hidden="true" />
                {photoBusy ? "正在识别照片" : "选择试卷照片"}
              </Button>
              <div className="notice-slot photo-notice">{noticeView}</div>
            </section>
          </TabsContent>
        </Tabs>

        <section className="coverage" aria-label="试卷索引覆盖范围">
          <div className="coverage-icon"><FileText size={25} strokeWidth={1.65} aria-hidden="true" /></div>
          {indexState === "loading" ? (
            <Skeleton className="coverage-skeleton" label="正在载入试卷索引" lines={2} />
          ) : indexState === "error" ? (
            <p>试卷索引暂时无法载入，请联网后刷新。</p>
          ) : (
            <p>
              已收录 {papers.length} 份 IGCSE / IAL 试卷，覆盖 {subjects.length} 个科目。
              <span>索引更新：{updated}。</span>
            </p>
          )}
        </section>

        {mode !== "camera" && <div className="privacy-note"><ShieldCheck size={15} aria-hidden="true" />条码在本机识别，不会上传照片。</div>}
      </section>

      <footer className="home-footer">
        <span>PaperScan</span>
        <a href="https://www.paperlords.org/igcse" target="_blank" rel="noopener noreferrer">
          试卷目录：PaperLords <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </footer>

      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent title="放到你的主屏幕" description="下次从主屏幕就能快速打开 PaperScan。">
          <ol className="install-steps">
            <li>在浏览器菜单中打开「分享」。</li>
            <li>选择「添加到主屏幕」。</li>
            <li>点击「添加」完成安装。</li>
          </ol>
          <p className="install-hint">菜单名称会因浏览器不同而略有差异。</p>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default App;
