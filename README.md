# PaperScan

Mobile-first Edexcel IGCSE and IAL barcode finder covering 28 subjects. Scan a paper barcode with the camera or a photo, or enter it manually. Install from Safari's Share → Add to Home Screen. Recognition runs locally using the vendored ZXing Browser 0.1.5 bundle (MIT license included).

The paper library can be searched by qualification, subject, session, unit, or barcode. Recent scans and favorites stay in the browser on the device. Camera users can enable an optional success tone or vibration; a torch control appears when the camera supports it.

## Development

```sh
npm ci
npm run dev
```

`npm run build` creates the deployable site in `dist/`. `npm test` checks barcode parsing, saved history/favorites, and index validation; `npm run typecheck` checks the React source; `npm run validate:data` checks the paper index. GitHub Pages runs these checks and builds `dist/` through Actions.

`npm run check:links` checks the external PDF links. GitHub Actions runs the live check weekly and can also be started manually. Temporary HTTP restrictions are reported as unverified; confirmed missing links fail the check.

## Data and privacy

`public/papers.json` contains verified identifiers extracted from publicly reachable PDF cover pages indexed by PaperLords and Pearson; no exam PDFs are redistributed. Mark schemes pair by qualification, subject, unit, variant and exam session. Unmatched identifiers never produce guessed PDF links. `tools/import-paperlords.py` rebuilds the source index from the public IGCSE and IAL archive.

Camera access requires HTTPS. Scan history, favorites, and feedback preferences are stored locally in browser storage. The service worker caches the app and index; opening external PDFs requires connectivity. Real-device iOS camera, torch, and installation behavior should be checked on the target phone.

The current index contains 1,601 unique publication barcodes across 28 IGCSE and IAL subjects. It is a snapshot, not a continuously updating database. Restricted materials are not accessed. Runtime has no external API key, account integration or backend dependency.
