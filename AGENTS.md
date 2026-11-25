# このリポジトリでの作業

- 本作はセカソコ本編と独立した「セカソコ！～手駒編～」。本編のリポジトリ、HTML、Google Driveなどにはアクセス・変更しない。
- 編集対象は `src/engine.js`（共通マスターとルール）、`src/ui.js`（表示と操作）、`src/shell.html`（構造とCSS）。生成物 `index.html` だけを直接編集しない。
- 更新後は `npm run build` を実行し、ソースと `index.html` を一緒に提出する。`npm run check` で生成結果の一致を検証する。
- 環境はPython 3とNode.js 24。`npm ci`、必要なら `npx playwright install --with-deps chromium` で検証環境を準備する。
- ルール変更は `npm run test:engine`、操作・画面変更は `npm run test:ui` で検証する。まとめて実行する場合は `npm test`。ローカル起動は `npm run dev`。
- ゲームは外部通信に依存しない単一HTMLを維持する。VER.001ではセーブ、音、育成、召喚などの対象外機能を先回りして追加しない。
- iPhone相当サイズのChromium検証と、実機Safari検証を区別して報告する。
