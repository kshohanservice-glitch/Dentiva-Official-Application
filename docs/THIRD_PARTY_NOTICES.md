# Dentiva Pro — Third-Party Notices

Dentiva Pro bundles the components below. Each keeps its original license; the app itself is proprietary (© 2026 Shohan Khan).

## Runtime dependencies

| Component | Version | License | How it is used |
|---|---|---|---|
| better-sqlite3 | 11.10.0 | MIT | Local SQLite database engine (native module, `asarUnpack`ed) |

## Bundled-at-build-time components (shipped inside `dist/`)

| Component | Version | License | How it is used |
|---|---|---|---|
| React / ReactDOM | 18.3.1 | MIT | UI rendering |
| react-router-dom | 6.30.6 | MIT | In-app navigation |
| @tanstack/react-query | 5.104.0 | MIT | Data fetching/caching over IPC |
| zod | 3.25.76 | MIT | IPC input validation |
| @noble/hashes | 2.4.0 | MIT | Argon2id password hashing + SHA-256 (audit chain, backups) — pure JS, no native crypto |
| yauzl | 3.2.0 | MIT | Reading `.dvbackup` archives (restore verification) |
| yazl | 3.3.1 | MIT | Creating `.dvbackup` archives |
| Inter (font files) | 5.3.0 (@fontsource/inter) | SIL OFL 1.1 | UI typeface (`assets/fonts/inter-latin-*.woff2`) |
| Noto Sans Bengali (font files) | 5.3.0 (@fontsource/noto-sans-bengali) | SIL OFL 1.1 | Bengali text in UI, PDF and print (`assets/fonts/noto-sans-bengali-*.woff2`) |

## Build/dev toolchain (not shipped)

electron, electron-builder, esbuild, vite, @vitejs/plugin-react, typescript, vitest, @playwright/test, eslint + @typescript-eslint, prettier — all MIT/Apache-2.0/BSD as published in their packages.

## Full license text

- MIT: <https://opensource.org/licenses/MIT>
- SIL Open Font License 1.1: <https://openfontlicense.org>

The bundled font files are unmodified @fontsource builds and retain their OFL copyright statements.

`npm ls --omit=dev` (local, 2026-09-28): `better-sqlite3@11.10.0` — the single production dependency; everything else above is bundled into `dist/` at build time, so the installer carries exactly these components.
