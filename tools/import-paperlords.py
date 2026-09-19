"""Build PaperScan's barcode index from PaperLords' public IGCSE/IAL archive.

Only metadata and links are stored. Exam PDFs are read in memory to extract the
Pearson publication barcode from page one and are never written to this repo.
"""

from __future__ import annotations

import concurrent.futures
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "dist" / "papers.json"
API = "https://lldrclumayqoegzfxdcb.supabase.co/rest/v1/papers"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsZHJjbHVtYXlxb2VnemZ4ZGNiIiw"
    "icm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNDEwNjEsImV4cCI6MjA4MzcxNzA2MX0."
    "lb7hAjOku_mcU_-o9EJlhA-74eSpMm3U27ssoQW5c5o"
)
BARCODE = re.compile(r"P\d{5,7}[A-Z]")


def request_json(url: str) -> list[dict]:
    request = urllib.request.Request(
        url,
        headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "User-Agent": "PaperScan index builder",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def fetch_archive() -> list[dict]:
    rows: list[dict] = []
    for category in ("IGCSE", "IAL"):
        offset = 0
        while True:
            query = urllib.parse.urlencode(
                {
                    "select": "subject,unit,session,type,variant,link,category",
                    "category": f"eq.{category}",
                    "deleted_at": "is.null",
                    "order": "subject,session,unit,type",
                    "offset": offset,
                    "limit": 1000,
                }
            )
            page = request_json(f"{API}?{query}")
            rows.extend(page)
            if len(page) < 1000:
                break
            offset += 1000
    return rows


def record_key(row: dict) -> tuple[str, str, str, str, str]:
    return (
        row["category"],
        row["subject"],
        row["session"],
        row["unit"],
        row.get("variant") or "",
    )


def extract_barcode(row: dict) -> tuple[dict, str | None, str | None]:
    url = row["link"].replace(" ", "%20")
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read()
            text = PdfReader(io.BytesIO(payload)).pages[0].extract_text() or ""
            codes = BARCODE.findall(text.upper().replace(" ", ""))
            return row, (Counter(codes).most_common(1)[0][0] if codes else None), None
        except Exception as exc:  # network and malformed legacy PDFs are expected
            if attempt == 2:
                return row, None, f"{type(exc).__name__}: {exc}"
            time.sleep(0.5 * (attempt + 1))
    return row, None, "unreachable"


def title_for(row: dict) -> str:
    return f"{row['subject']} {row['unit']}"


def main() -> int:
    old = json.loads(INDEX.read_text(encoding="utf-8"))["papers"]
    rows = fetch_archive()
    mark_schemes = {
        record_key(row): row["link"]
        for row in rows
        if row["type"] == "MS" and str(row["link"]).lower().endswith(".pdf")
    }
    question_papers = [
        row
        for row in rows
        if row["type"] == "QP" and str(row["link"]).lower().endswith(".pdf")
    ]

    imported: list[dict] = []
    failures: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        futures = [pool.submit(extract_barcode, row) for row in question_papers]
        for number, future in enumerate(concurrent.futures.as_completed(futures), 1):
            row, code, error = future.result()
            if code:
                imported.append(
                    {
                        "code": code,
                        "qualification": row["category"],
                        "subject": row["subject"],
                        "unit": row["unit"],
                        "name": title_for(row),
                        "session": row["session"],
                        "qp": row["link"],
                        "ms": mark_schemes.get(record_key(row)),
                        "source": "PaperLords",
                    }
                )
            else:
                failures.append(f"{row['category']} | {row['subject']} | {row['session']} | {row['unit']} | {error}")
            if number % 100 == 0:
                print(f"Processed {number}/{len(question_papers)}", file=sys.stderr)

    # Preserve previously verified Pearson links when a PaperLords record has
    # the same publication code.
    by_code = {paper["code"]: paper for paper in imported}
    for paper in old:
        existing = by_code.get(
            paper["code"],
            {"qualification": "IAL", "subject": "Maths", "source": "Pearson"},
        )
        by_code[paper["code"]] = {**existing, **paper}
    papers = sorted(by_code.values(), key=lambda p: (p.get("qualification", "IAL"), p.get("subject", "Maths"), p["session"], p["unit"]))
    qualifications = sorted({paper.get("qualification", "IAL") for paper in papers})
    subjects = sorted({f"{paper.get('qualification', 'IAL')} · {paper.get('subject', 'Maths')}" for paper in papers})
    output = {
        "updated": date.today().isoformat(),
        "qualifications": qualifications,
        "subjects": subjects,
        "papers": papers,
    }
    INDEX.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(papers)} unique barcode records across {len(subjects)} subjects")
    print(f"Skipped {len(failures)} question papers without a readable barcode")
    for failure in failures:
        print(f"SKIP {failure}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
