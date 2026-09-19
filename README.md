# PaperScan

Static, mobile-first Edexcel IGCSE and IAL barcode finder covering 28 subjects. Install from Safari's Share → Add to Home Screen. Barcode recognition runs locally using the vendored ZXing Browser 0.1.5 bundle (MIT license included).

`dist/` is the complete application. `papers.json` contains verified identifiers extracted from publicly reachable PDF cover pages indexed by PaperLords and Pearson; no exam PDFs are redistributed. Mark schemes pair by qualification, subject, unit, variant and exam session. Unmatched identifiers never produce guessed PDF links. `tools/import-paperlords.py` rebuilds the index from the public IGCSE and IAL archive.

Camera access requires HTTPS. The service worker caches the app and index; opening external PDFs requires connectivity. Real-device iOS camera and installation behavior must be checked on the target phone.

The current index contains 1,601 unique publication barcodes across 28 IGCSE and IAL subjects. It is a snapshot, not a continuously updating database. Restricted materials are not accessed. Runtime has no external API key, account integration or backend dependency.
