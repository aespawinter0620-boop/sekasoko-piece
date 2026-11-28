# セカソコ！～手駒編～ VER.010

『お気に入りの手駒と、世界の底へ。』のボードバトル試作。
論理7×5の盤面で戦闘開始時は最大12体の軍団を率い、敵を捕獲してその戦闘中に再出撃させながら10F踏破を目指す。初期所有は王・騎士・弓兵の3体。探索前に所有個体から編成する。

セカソコ本編とは独立した開発系列。ゲーム本体は外部ライブラリや外部通信に依存しない単一HTMLで動く。育成・セーブ・音・アプリ化は現在の実装対象外。

## 遊ぶ

[ゲームを開く（GitHub Pages）](https://aespawinter0620-boop.github.io/sekasoko-piece/)

GitHub Pagesの公開URLをSafariなどのブラウザーで開く。縦画面は横5列×縦7行で味方が下・敵が上、横画面は横7列×縦5行で味方が左・敵が右。縦はコンパクトな情報欄の下に盤を広く表示し、横は盤が左・HUDとステータスが右。マスの縦は横の0.9倍を保ち、向きを変えても戦闘の進行・選択・攻撃対象の選択を保つ。

- 盤上はアイコンとHPで手駒を見分け、選ぶと種類名と能力を確認できる。
- 味方の駒 → 青いマスで移動、または赤い敵で攻撃。ステータスの「通常攻撃」から対象選択にも入れる。対象を決めるまで手番は消費しない。移動・攻撃はそれぞれ1行動で、敵と交代する。
- 王以外を撃破すると、同じ個体をその陣営の捕獲手駒へ移す。敵も同じ条件で捕獲・再捕獲する。
- 自分の捕獲手駒を選び、全35マスの空きマスへ最大HPで再出撃できる。敵陣や敵王の隣もOK。コストなし・1行動。戦闘中の盤上人数上限はなく、敵味方とも空きマスがある限り出撃できる。
- 敵の王を倒せば勝利。今回の敵出自で、現在味方の手駒欄か味方盤上にいる個体だけを100%正式獲得する。奪い返されたままの敵は獲得しない。
- 階層の間に王1体＋手駒最大11体、コスト合計35以内で編成。同じ種類も複数使える。全員が復帰し、HP全回復する。
- 弓兵は通常攻撃への支援射撃、騎士は隣接味方への鼓舞、ゴーレムは隣接味方をかばう守護の石壁を自動で使う。一連の攻撃と追撃はまとめて1行動。
- 元から所有する味方は、奪われたままでも勝敗を問わず元の所有IDで返還する。敗北時は新規獲得なし。10F踏破で試作版クリア。再挑戦は探索を初期化する。
- 待機は未選択でも使える。ログはボタンで開き、遊び方とやり直しはメニューから操作する。固有技・必殺技は「未実装」の無効ボタン。自動パッシブの発動にこのボタン操作は不要。
- 捕獲通知は戦闘中の所属移転の案内。正式な所有確定とは区別し、勝利・10Fクリアの結果で獲得と返還を確認する。

PCではダウンロードした `index.html` をブラウザーで直接開いても遊べる。ファイルを `sekasoko_piece_ver010.html` に変えて配布しても動作する。端末内に自動保存し、再読み込み・再起動で探索途中から再開する。

iPhoneの「ファイル」アプリのプレビューではJavaScriptが実行されない場合があるため、実機確認はHTTP経由でSafariに読み込む方法を推奨する。

iPhoneホーム画面・ブラウザー用の仮アイコン：採用済みの文字なし黄金の王冠と剣のPNG原本を `assets/icons/sekasoko_icon_temp.png` として受領・保存。派生画像の白い外周・余白を除去し、黄金紋章を端まで敷き詰めた角丸加工なしの180px apple-touch-icon、16／32px PNG favicon、16／32／48px ICOを設定。原本と図柄は維持し、新規画像生成は行っていない。 再生成は `python3 scripts/build_icons.py`（開発時のみPillowが必要）。アイコン込みでローカル配布する場合は `assets/icons/` も同梱する。

VER.010は永続所有と探索前編成、localStorageによる自動保存を追加。新しい探索は所有駒を保持し、メニューの「全セーブデータ初期化」だけが初期3体へ戻す。保存は同じブラウザー・端末内。

## 開発環境

Python 3、Node.js 24、npmを使う。ゲームを遊ぶだけならこれらのインストールは不要。

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm run test:engine
npm run test:inventory
npm run test:ui
npm run test:responsive
npm run dev
```

開発サーバーは `http://localhost:3000/`。同じWi-FiのiPhoneから確認する場合は `http://PCのIPアドレス:3000/` をSafariで開く。サーバーはCtrl+Cで停止する。

`npm ci` とPlaywrightのブラウザー導入は開発・検証用。初回導入にはネットワークが必要だが、ゲーム本体の実行には不要。既存のChromiumを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に実行ファイルのパスを指定できる。

## 構成と更新

| パス | 内容 |
| --- | --- |
| `src/engine.js` | 共通マスター、軍団設定、パッシブ、攻撃予測、捕獲・再出撃・正式獲得・返還、編成、階層進行、AI |
| `src/ui.js` | 操作、画面表示、演出、ダイアログ |
| `src/shell.html` | HTML構造とCSS |
| `scripts/build.py` | ソースを単一HTMLへ組み込むビルド処理 |
| `index.html` | 生成済みのゲーム本体。GitHub Pagesで配信するファイル |
| `tests/` | 戦闘ルールとブラウザー操作の検証 |
| [`docs/CURRENT_SPEC.md`](docs/CURRENT_SPEC.md) | 対応コードコミットを明記した、現行仕様の全文 |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | バージョンごとの累積変更履歴 |
| `assets/characters/` | 今後のキャラクター画像の置き場。現時点では正式画像なし |

更新時は `src/` を編集し、`npm run build` で `index.html` を再生成する。ソースと生成結果を一緒にコミットする。`index.html` だけを直接編集すると、次のビルドで上書きされる。

`npm run check` はソースと `index.html` の一致を変更なしで確認する。`npm run test:responsive` は表示方向・サイズ変更・回転中の進行を検証する。`npm test` は一致確認・エンジン検証・画面操作・表示方向の検証をまとめて実行する。

`npm run test:oracle` は固定シードの独立した計算と攻撃予測を照合する補助検証。`npm test` とCIにも含める。

`npm run test:inventory` は `scripts/verify_inventory.cjs` で個体の一意性・出自・所属・盤上／手駒・正式獲得・返還を独立に監査する。`npm test` とCIにも含め、合成方策の検査をAI評価や実機検証とは区別する。

`npm run observe:army` で軍団戦のAI行動・捕獲・再出撃・長期化を観察できる。合成的な観察結果をバランス調整済み・実機検証済みとは扱わない。

画像を導入するときは、単一HTMLのオフライン実行を保つならビルドでの埋め込みも検討する。現状のビルドは画像を自動では埋め込まない。

## GitHub Pages

リポジトリの **Settings → Pages → Build and deployment** で **Source: GitHub Actions** を選ぶ。

公開後のURLはPages設定画面とActionsのデプロイ結果に表示される。以後は `src/` の修正、ビルド、検証を行い、`index.html` を含めて `main` に反映すると更新される。

`.github/workflows/ci.yml` はpushとPRでビルド結果の一致・エンジン・画面操作を検証する。**`main` へのpushが全検証に合格した場合だけ**、続くdeployジョブがPagesを更新する。PRやタグのpushでは公開しない。

Pagesには `index.html` と `assets/` だけを配信し、開発用ソース、テスト、依存パッケージは配信しない。デプロイ権限はdeployジョブだけに付けている。

## 検証状況

VER.001の初回検証では、戦闘ルール **19/19**、ブラウザー操作 **14/14** が合格。移動・攻撃・交互手番・勝敗・獲得候補・重複編成・コスト制限・全回復／復帰・1F～10F進行・再挑戦を確認した。

画面操作はPlaywright＋Chromiumで実行し、844×390、667×375、390×844で横はみ出しがないことを確認。勝敗などの分岐は検証用状態から実際のボタンで操作しており、人が10階層を通して遊んだバランス検証とは異なる。

VER.010の実施済み検証と現在の画面仕様は [現行仕様](docs/CURRENT_SPEC.md) を参照。開発側のiPhone実機およびSafari／WebKit検証は未実施。小さい画面では一部の情報や手駒一覧をスクロールして確認する。

## 仕様書と履歴の更新

[現行仕様](docs/CURRENT_SPEC.md) は最新実装の全文、[変更履歴](docs/CHANGELOG.md) は各版の累積記録として使う。公開Issueは [文書運用 #1](https://github.com/aespawinter0620-boop/sekasoko-piece/issues/1) と [画面調整 #2](https://github.com/aespawinter0620-boop/sekasoko-piece/issues/2)、[操作画面整理 #3](https://github.com/aespawinter0620-boop/sekasoko-piece/issues/3)、[縦横の表示最適化 #5](https://github.com/aespawinter0620-boop/sekasoko-piece/issues/5)、[12体の軍団戦 #6](https://github.com/aespawinter0620-boop/sekasoko-piece/issues/6)、[AIと自動パッシブ #7](https://github.com/aespawinter0620-boop/sekasoko-piece/issues/7)、[捕獲・再出撃 #8](https://github.com/aespawinter0620-boop/sekasoko-piece/issues/8)。

変更時は次の順で整える。

1. ソースと必要なテストを変更し、ビルドと該当検証を実行する。
2. コードとテストをコミットし、そのコミットを文書の「対応コードコミット」に記録する。
3. 現行仕様を全文更新し、変更履歴に追記する。対応バージョンと実施済み検証を明記し、文書を別コミットで保存する。
4. 正式なDrive開発正本の同名文書にも同じ全文を反映する。接続できなければ編集可能な全文を渡し、Drive反映が未完了と報告する。
5. 検証済みコードと対応文書がそろったリリースに注釈付きタグを付けて公開する。

正式Driveの非公開URLや個人情報は公開リポジトリへ載せない。公開で参照する仕様書はこのリポジトリの `docs/` を使う。

## バージョン保存と巻き戻し

各バージョンは、検証済みのコードをコミットし、そのコミットに注釈付きタグを付けて保存する。

| ゲーム内の表記 | Gitタグ |
| --- | --- |
| VER.001 | `v0.0.1` |
| VER.002 | `v0.0.2` |
| VER.003 | `v0.0.3` |
| VER.004 | `v0.0.4` |
| VER.005 | `v0.0.5` |
| VER.006 | `v0.0.6` |
| VER.007 | `v0.0.7` |
| VER.008 | `v0.0.8` |
| VER.009 | `v0.0.9` |
| VER.010 | `v0.0.10` |

公開済みのタグは移動・削除・上書きしない。修正や復元も新しいコミットで残し、次の未使用バージョン番号を使う。

次版を保存する例：上の手順でコード・テストと対応文書のコミットまで済ませ、リリース対象のコミットに次の未使用タグを付ける。

```sh
git tag -a v0.0.10 -m "セカソコ！～手駒編～ VER.010"
git push origin main
git push origin v0.0.10
```

PRで開発する場合は、検証済みの変更が `main` に入った後のリリース対象コミットにタグを付ける。タグは保存地点。タグのpushでは公開せず、GitHub Pagesには検証に合格した `main` の `index.html` を配信する。

### VER.008へ戻す場合

検証済みタグ `v0.0.8` を復元元にし、下の手順のブランチ名を `restore/ver008`、復元元を `v0.0.8` に置き換える。ソース・生成HTML・依存関係・テスト・CIをまとめて復元し、現在の `docs/` を保持して復元後の仕様と履歴を更新する。既存の公開タグを移動したり、履歴を強制プッシュしたりしない。

### VER.001へ戻す例

作業中の変更を先にコミットまたは退避し、最新の `main` から復元用ブランチを作る。リポジトリのルートで実行する。

```sh
git switch main
git pull --ff-only
git switch -c restore/ver001
git restore --source v0.0.1 -- src scripts tests assets index.html package.json package-lock.json .github
npm ci
npm run build
npm test
# docs/CURRENT_SPEC.mdを復元後の仕様に更新し、docs/CHANGELOG.mdへ復元を追記
git add -A
git commit -m "Restore VER.001 from v0.0.1"
git push -u origin restore/ver001
```

`restore/ver001` から `main` へのPRを作り、差分とCIを確認してマージするとPagesもVER.001の内容へ戻る。`src/` と生成済みHTMLに加え、依存関係・テスト・アイコン素材・CIをタグ時点へ復元するため、HTMLだけ戻した後にビルドで上書きされることを防げる。`docs/`、AGENTS、READMEは最新版を保持し、現行仕様書を復元後の挙動へ更新して、変更履歴へロールバックを追記してからコミットする。過去の履歴を古いタグの内容で消さない。

復元前までの履歴は残る。復元版にも必要に応じて次の未使用番号のタグを付け、既存の `v0.0.1` はそのまま保持する。履歴を書き換える操作や強制プッシュは不要。
