import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, Clock3, Star, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import type { Paper } from "@/lib/papers";
import type { PaperScanState } from "@/lib/paper-store.types";

type LibraryTab = "all" | "recent" | "favorites";
type LibraryItem = { code: string; paper?: Paper; barcode?: string; scannedAt?: number };

interface PaperLibraryProps {
  papers: Paper[];
  saved: PaperScanState;
  indexState: "loading" | "ready" | "error";
  storageWarning: boolean;
  onBack: () => void;
  onOpenBarcode: (barcode: string) => void;
  onToggleFavorite: (code: string) => void;
  onClearHistory: () => void;
}

function sessionScore(session: string) {
  const year = Number(session.match(/\d{4}/)?.[0] ?? 0);
  const text = session.toLowerCase();
  const month = text.includes("jan") ? 1
    : text.includes("feb") ? 2
      : text.includes("mar") ? 3
        : text.includes("may") ? 5
          : text.includes("jun") ? 6
            : text.includes("jul") ? 7
              : text.includes("aug") ? 8
                : text.includes("sep") ? 9
                  : text.includes("oct") ? 10
                    : text.includes("nov") ? 11
                      : text.includes("dec") ? 12 : 0;
  return year * 12 + month;
}

function formatScanDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(new Date(timestamp));
}

export function PaperLibrary({
  papers,
  saved,
  indexState,
  storageWarning,
  onBack,
  onOpenBarcode,
  onToggleFavorite,
  onClearHistory,
}: PaperLibraryProps) {
  const reduced = useReducedMotion();
  const [tab, setTab] = useState<LibraryTab>("all");
  const [query, setQuery] = useState("");
  const [qualification, setQualification] = useState("all");
  const [subject, setSubject] = useState("all");
  const [session, setSession] = useState("all");
  const [limit, setLimit] = useState(48);
  const paperByCode = useMemo(() => new Map(papers.map((paper) => [paper.code, paper])), [papers]);
  const qualifications = useMemo(() => [...new Set(papers.map((paper) => paper.qualification))].sort(), [papers]);
  const subjects = useMemo(() => [...new Set(papers
    .filter((paper) => qualification === "all" || paper.qualification === qualification)
    .map((paper) => paper.subject))].sort((a, b) => a.localeCompare(b)), [papers, qualification]);
  const sessions = useMemo(() => [...new Set(papers.map((paper) => paper.session))]
    .sort((a, b) => sessionScore(b) - sessionScore(a) || b.localeCompare(a)), [papers]);
  // Deduplicate by paper code: scanning two pages of one paper is still one paper.
  const recentItems = useMemo<LibraryItem[]>(() => {
    const seen = new Set<string>();
    return saved.history.flatMap((entry) => {
      if (seen.has(entry.code)) return [];
      seen.add(entry.code);
      return [{ code: entry.code, paper: paperByCode.get(entry.code), barcode: entry.barcode, scannedAt: entry.scannedAt }];
    });
  }, [paperByCode, saved.history]);
  const items = useMemo<LibraryItem[]>(() => {
    if (tab === "favorites") {
      return saved.favorites.map((code) => ({ code, paper: paperByCode.get(code) }));
    }
    if (tab === "recent") return recentItems;
    return papers.map((paper) => ({ code: paper.code, paper }));
  }, [papers, paperByCode, recentItems, saved.favorites, tab]);
  const filteredItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const paper = item.paper;
      if (qualification !== "all" && paper?.qualification !== qualification) return false;
      if (subject !== "all" && paper?.subject !== subject) return false;
      if (session !== "all" && paper?.session !== session) return false;
      if (!term) return true;
      return [item.code, item.barcode, paper?.name, paper?.qualification, paper?.subject, paper?.unit, paper?.session]
        .some((value) => value?.toLocaleLowerCase().includes(term));
    });
  }, [items, query, qualification, session, subject]);
  const visibleItems = filteredItems.slice(0, limit);

  function changeTab(value: LibraryTab) {
    setTab(value);
    setLimit(48);
  }

  function clearFilters() {
    setQuery("");
    setQualification("all");
    setSubject("all");
    setSession("all");
    setLimit(48);
  }

  return (
    <section className="library-screen" aria-labelledby="library-title">
      <div className="library-heading">
        <div className="library-title-mark"><BookOpen size={21} aria-hidden="true" /></div>
        <div>
          <h1 id="library-title">Library</h1>
          <p>Every paper in the index, plus what you scanned and saved.</p>
        </div>
      </div>

      {storageWarning ? (
        <p className="library-storage-note" role="status">
          This browser is limiting local storage. Favorites and history last for this session only.
        </p>
      ) : null}

      {indexState === "error" ? (
        <div className="library-empty">
          <BookOpen size={28} aria-hidden="true" />
          <h2>Index unavailable</h2>
          <p>Refresh while connected to browse the library.</p>
        </div>
      ) : (
        <>
          <div className="library-tabs" role="group" aria-label="Library view">
            <button type="button" aria-pressed={tab === "all"} className={tab === "all" ? "is-active" : ""} onClick={() => changeTab("all")}>
              <BookOpen size={16} aria-hidden="true" />All papers
            </button>
            <button type="button" aria-pressed={tab === "recent"} className={tab === "recent" ? "is-active" : ""} onClick={() => changeTab("recent")}>
              <Clock3 size={16} aria-hidden="true" />Recent{recentItems.length ? <span>{recentItems.length}</span> : null}
            </button>
            <button type="button" aria-pressed={tab === "favorites"} className={tab === "favorites" ? "is-active" : ""} onClick={() => changeTab("favorites")}>
              <Star size={16} aria-hidden="true" />Favorites{saved.favorites.length ? <span>{saved.favorites.length}</span> : null}
            </button>
          </div>

          <div className="library-filters" aria-label="Filter the library">
            <Input
              id="library-search"
              className="library-search-input"
              label="Search papers"
              placeholder="Subject, code, unit, or session"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setLimit(48); }}
            />
            <label className="library-filter">
              <span>Qualification</span>
              <select value={qualification} onChange={(event) => { setQualification(event.target.value); setSubject("all"); setLimit(48); }}>
                <option value="all">All</option>
                {qualifications.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="library-filter">
              <span>Subject</span>
              <select value={subject} onChange={(event) => { setSubject(event.target.value); setLimit(48); }}>
                <option value="all">All</option>
                {subjects.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="library-filter">
              <span>Session</span>
              <select value={session} onChange={(event) => { setSession(event.target.value); setLimit(48); }}>
                <option value="all">All</option>
                {sessions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>

          <div className="library-results-heading">
            <p>{indexState === "loading" ? "Loading the index…" : `Showing ${visibleItems.length} of ${filteredItems.length}`}</p>
            {tab === "recent" && saved.history.length > 0 ? (
              <Button className="clear-history-action" variant="ghost" size="sm" onClick={onClearHistory}>
                <Trash2 size={15} aria-hidden="true" />Clear history
              </Button>
            ) : null}
          </div>

          {indexState === "loading" ? (
            <div className="library-empty" role="status"><p>Loading the paper index…</p></div>
          ) : visibleItems.length === 0 ? (
            <div className="library-empty">
              <BookOpen size={28} aria-hidden="true" />
              <h2>{tab === "favorites" ? "No favorites yet" : tab === "recent" ? "No scans yet" : "No papers found"}</h2>
              <p>{tab === "favorites" ? "Star a paper here or on its result page to keep it close." : tab === "recent" ? "Scanned codes are saved on this device." : "Try a shorter search, or clear a filter."}</p>
              {(query || qualification !== "all" || subject !== "all" || session !== "all") ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
              ) : null}
            </div>
          ) : (
            <div className="library-list">
              {visibleItems.map((item, index) => {
                const paper = item.paper;
                const favorite = saved.favorites.includes(item.code);
                const scanBarcode = item.barcode ?? item.code;
                return (
                  <motion.article
                    className="library-card"
                    key={`${item.code}:${item.barcode ?? tab}`}
                    initial={reduced ? false : { opacity: 0, y: 14, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{
                      duration: 0.45,
                      delay: reduced ? 0 : Math.min(index, 10) * 0.025,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    <div className="library-card-copy">
                      <p className="library-card-eyebrow">{paper ? `${paper.qualification} · ${paper.subject}` : "Scan not in the index"}</p>
                      <h2>
                        {paper ? (
                          <button
                            type="button"
                            className="library-card-open"
                            aria-label={`Open ${paper.name} details`}
                            onClick={() => onOpenBarcode(scanBarcode)}
                          >
                            {paper.name}
                          </button>
                        ) : (
                          item.code
                        )}
                      </h2>
                      <p className="library-card-meta">{paper ? `${paper.session} · ${paper.unit} · ${item.code}` : "Edit the code and try again"}</p>
                      {item.scannedAt ? (
                        <time dateTime={new Date(item.scannedAt).toISOString()}>
                          <Clock3 size={13} aria-hidden="true" />Recent · {formatScanDate(item.scannedAt)}
                        </time>
                      ) : null}
                    </div>
                    <div className="library-card-actions">
                      <Button
                        className="favorite-action"
                        variant="ghost"
                        size="sm"
                        aria-label={favorite ? `Remove ${item.code} from favorites` : `Add ${item.code} to favorites`}
                        aria-pressed={favorite}
                        onClick={() => onToggleFavorite(item.code)}
                      >
                        <motion.span
                          key={String(favorite)}
                          style={{ display: "inline-flex" }}
                          initial={reduced ? false : { scale: 0.6, rotate: -14 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 20 }}
                        >
                          <Star size={17} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
                        </motion.span>
                      </Button>
                      {paper?.qp ? (
                        <a className="library-document-action" href={paper.qp} target="_blank" rel="noopener noreferrer">
                          Open paper <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                      ) : null}
                      {paper?.ms ? (
                        <a className="library-document-action library-mark-scheme" href={paper.ms} target="_blank" rel="noopener noreferrer">
                          Mark scheme <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                      ) : null}
                      {paper && !paper.qp ? <span className="library-resource-note">PDF unavailable</span> : null}
                      {paper ? null : (
                        <Button variant="secondary" size="sm" onClick={() => onOpenBarcode(scanBarcode)}>
                          Edit code
                        </Button>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </div>
          )}

          {visibleItems.length < filteredItems.length ? (
            <Button className="load-more-action" variant="secondary" onClick={() => setLimit((current) => current + 48)}>
              Show 48 more
            </Button>
          ) : null}
          <p className="library-local-note">Favorites and recent scans stay on this device.</p>
        </>
      )}
      <Button className="library-back-action" variant="ghost" onClick={onBack}>Back to scanner</Button>
    </section>
  );
}
