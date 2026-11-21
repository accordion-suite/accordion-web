# Accordion Web

The Accordion web app: Drive, Docs, Notes, Settings, and every later module in your browser, installable on phones and computers. It's a TypeScript app built with esbuild and Preact, as [decision 13](https://github.com/accordion-suite/accordion/blob/main/docs/decisions/0013-the-web-app.md) explains.

This repo is part of [Accordion](https://github.com/accordion-suite/accordion), a self-hosted, zero-telemetry replacement for Google Workspace. Please open issues in the [main repo](https://github.com/accordion-suite/accordion/issues).

## Layout

- `src/shell/`: the app's frame, with sign-in, the top bar and app picker, menus, dialogs, the bell, live updates, and moving between pages. `shell/coedit.ts` keeps a Yjs document in step with the server for editing together, for Notes and Docs alike.
- `src/drive/`, `src/docs/`, and `src/notes/`: one folder per module, with its pages. A module's pages call only its own API, such as `/api/drive`, and the server's shared endpoints, such as `/api/session`, so they could move with their module later. Docs' editor is built on ProseMirror and y-prosemirror.
- `src/settings/`: Settings, with a page for each section, in groups for you, each module, and the server.
- `src/messages/`: every string the app shows, in English, ready for translation. `en.ts` has the shell's and Drive's, and each other module has a file of its own, which loads with it.
- `src/icon/`: the app's icon. `icon.svg` has rounded corners, and `icon-maskable.svg` fills the square, for phones that cut the icon to their own shape. The PNGs are exports of those SVGs at the sizes in their names, with `apple-touch-icon.png` at 180 pixels from `icon-maskable.svg`. After changing an SVG, export its PNGs again.
- `scripts/build.ts`: the build, which writes `dist/`.

## Building

You need Node.js 22 or later. Install the packages without running their install scripts, then check, test, and build:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

The build writes the app to `dist/`, with compressed copies of each file, and fails if Drive's first load is over its 150 KB budget. Docs, Notes, and Settings load only when they first open, so they stay out of that budget. Docs' 32 fonts come with the app, from Fontsource's copies of open fonts, so showing one never tells another site who's reading. The build copies each font's files into `dist/app/` from `src/docs/fonts.ts`, and the browser downloads only the ones a page uses. It also writes `dist/files.json`, each file's SHA-256 hash, which the server checks as it starts. With the same Node.js build, the same source always builds the same files, so release builds can be compared (decision 9). The suite's release build downloads a pinned Node.js for this.

To try the app, point a development server at the build with the `ACCORDION_WEB_DIR` setting, and rebuild after each change.

The code has no formatter settings. It's wrapped by hand at about 130 columns, so if you run Prettier, use `--print-width 130`.

## Adding a package

Each new package needs a reason in the commit that adds it, because every package is code that the build trusts. Install it with an exact version, and without install scripts:

```sh
npm install --ignore-scripts --save-exact <package>
```

CI checks that every package has a license that works with AGPL-3.0, or the SIL Open Font License for fonts, comes from npm's registry, and has a checksum in `package-lock.json`. The check is `scripts/check-npm-licenses.py` in the `accordion` repo, and CI reads it from that repo's `main`, so a newly allowed license has to reach `main` there before a package that uses it is pushed here.

## License

[AGPL-3.0 or later](LICENSE)
