# PaperScan

Static, mobile-first Edexcel Mathematics barcode finder. Install from Safari's Share → Add to Home Screen. Barcode recognition runs locally using the vendored ZXing Browser 0.1.5 bundle (MIT license included).

`dist/` is the complete application. `papers.json` contains verified identifiers extracted from publicly reachable Pearson PDF cover pages and source links; no exam PDFs are redistributed. Mark schemes pair by qualification/unit, paper reference and exam session. Unmatched identifiers never produce guessed PDF links. Open official PDFs and use Safari Share → Save to Files to download.

Camera access requires HTTPS. The service worker caches the app and index; opening external PDFs requires connectivity. Real-device iOS camera and installation behavior must be checked on the target phone.

The current index contains 149 IAL mathematics papers from 2019–2025. It is a snapshot, not an exhaustive or continuously updating database. Restricted materials are not accessed. Runtime has no external API key, account integration or backend dependency.
