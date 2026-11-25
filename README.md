# セカソコ！～手駒編～ VER.001

『お気に入りの手駒と、世界の底へ。』の初回プレイアブル試作。
7×5の盤面で王を守り、倒した敵を手駒に迎え、軍団を編成して10F踏破を目指す。

セカソコ本編とは独立した開発系列。ゲーム本体は外部ライブラリや外部通信に依存しない単一HTMLで動く。育成・セーブ・音・アプリ化はVER.001の対象外。

## 遊ぶ

GitHub Pagesの公開URLをSafariなどのブラウザーで開く。iPhoneは横画面を推奨。

- 味方の駒 → 青いマスで移動、または赤い敵で攻撃。移動・攻撃はそれぞれ1行動で、敵と交代する。
- 敵の王を倒せば勝利。先に撃破した敵の手駒だけを100%獲得する。王と生存敵は獲得できない。
- 階層の間に王1体＋手駒最大3体、コスト合計10以内で編成。同じ種類も複数使える。全員が復帰し、HP全回復する。
- 味方の王が倒れたら敗北。10F踏破で試作版クリア。どちらも最初から再挑戦できる。

PCではダウンロードした `index.html` をブラウザーで直接開いても遊べる。ファイルを `sekasoko_piece_ver001.html` に変えて配布しても動作する。再読み込み・ページ終了で進行は消える。

iPhoneの「ファイル」アプリのプレビューではJavaScriptが実行されない場合があるため、実機確認はHTTP経由でSafariに読み込む方法を推奨する。

## 開発環境

Python 3、Node.js 24、npmを使う。ゲームを遊ぶだけならこれらのインストールは不要。

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm run test:engine
npm run test:ui
npm run dev
```

開発サーバーは `http://localhost:3000/`。同じWi-FiのiPhoneから確認する場合は `http://PCのIPアドレス:3000/` をSafariで開く。サーバーはCtrl+Cで停止する。

`npm ci` とPlaywrightのブラウザー導入は開発・検証用。初回導入にはネットワークが必要だが、ゲーム本体の実行には不要。既存のChromiumを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に実行ファイルのパスを指定できる。

## 構成と更新

| パス | 内容 |
| --- | --- |
| `src/engine.js` | 全10種の共通キャラクターマスター、戦闘、獲得、編成、階層進行、AI |
| `src/ui.js` | 操作、画面表示、演出、ダイアログ |
| `src/shell.html` | HTML構造とCSS |
| `scripts/build.py` | ソースを単一HTMLへ組み込むビルド処理 |
| `index.html` | 生成済みのゲーム本体。GitHub Pagesで配信するファイル |
| `tests/` | 戦闘ルールとブラウザー操作の検証 |
| `assets/characters/` | 今後のキャラクター画像の置き場。現時点では正式画像なし |

更新時は `src/` を編集し、`npm run build` で `index.html` を再生成する。ソースと生成結果を一緒にコミットする。`index.html` だけを直接編集すると、次のビルドで上書きされる。

`npm run check` はソースと `index.html` の一致を変更なしで確認する。`npm test` は一致確認・エンジン検証・画面操作検証をまとめて実行する。

画像を導入するときは、単一HTMLのオフライン実行を保つならビルドでの埋め込みも検討する。現状のビルドは画像を自動では埋め込まない。

## GitHub Pages

リポジトリの **Settings → Pages → Build and deployment** で **Source: GitHub Actions** を選ぶ。

公開後のURLはPages設定画面とActionsのデプロイ結果に表示される。以後は `src/` の修正、ビルド、検証を行い、`index.html` を含めて `main` に反映すると更新される。

`.github/workflows/ci.yml` はpushとPRでビルド結果の一致・エンジン・画面操作を検証する。**`main` へのpushが全検証に合格した場合だけ**、続くdeployジョブがPagesを更新する。PRやタグのpushでは公開しない。

Pagesには `index.html` と `assets/` だけを配信し、開発用ソース、テスト、依存パッケージは配信しない。デプロイ権限はdeployジョブだけに付けている。

## 検証状況

VER.001の初回検証では、戦闘ルール **19/19**、ブラウザー操作 **14/14** が合格。移動・攻撃・交互手番・勝敗・獲得候補・重複編成・コスト制限・全回復／復帰・1F～10F進行・再挑戦を確認した。

画面操作はPlaywright＋Chromiumで実行し、844×390、667×375、390×844で横はみ出しがないことを確認。勝敗などの分岐は検証用状態から実際のボタンで操作しており、人が10階層を通して遊んだバランス検証とは異なる。

**iPhone実機およびSafari／WebKitは未検証。** 横画面では盤面の表示領域を使うためマスを横長にし、小さい画面では一部の情報や手駒一覧をスクロールして確認する。

## バージョン保存と巻き戻し

各バージョンは、検証済みのコードをコミットし、そのコミットに注釈付きタグを付けて保存する。

| ゲーム内の表記 | Gitタグ |
| --- | --- |
| VER.001 | `v0.0.1` |
| VER.002 | `v0.0.2` |
| VER.003 | `v0.0.3` |

公開済みのタグは移動・削除・上書きしない。修正や復元も新しいコミットで残し、次の未使用バージョン番号を使う。

次版を保存する例：ゲーム内のバージョン表記を更新し、ビルド・検証後にコミットとタグを作る。

```sh
npm run build
npm test
git add -A
git commit -m "Release VER.002"
git tag -a v0.0.2 -m "セカソコ！～手駒編～ VER.002"
git push origin main
git push origin v0.0.2
```

PRで開発する場合は、検証済みの変更が `main` に入った後のリリース対象コミットにタグを付ける。タグは保存地点。タグのpushでは公開せず、GitHub Pagesには検証に合格した `main` の `index.html` を配信する。

### VER.001へ戻す例

作業中の変更を先にコミットまたは退避し、最新の `main` から復元用ブランチを作る。リポジトリのルートで実行する。

```sh
git switch main
git pull --ff-only
git switch -c restore/ver001
git restore --source v0.0.1 -- .
npm ci
npm run build
npm test
git add -A
git commit -m "Restore VER.001 from v0.0.1"
git push -u origin restore/ver001
```

`restore/ver001` から `main` へのPRを作り、差分とCIを確認してマージするとPagesもVER.001の内容へ戻る。`src/` と生成済みHTMLに加え、依存関係・テスト・文書・CIもタグ時点へ復元するため、HTMLだけ戻した後にビルドで上書きされることを防げる。

復元前までの履歴は残る。復元版にも必要に応じて次の未使用番号のタグを付け、既存の `v0.0.1` はそのまま保持する。履歴を書き換える操作や強制プッシュは不要。
