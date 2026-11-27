# VER.008 仮アイコン

ユーザー指定の `sekasoko_icon_temp.png` は原本のまま保存。派生画像では白い外周と余白を除去し、外側の角を既存背景色で埋めて正方形の端まで敷き詰める。黄金の王冠と剣の紋章は維持し、新規画像生成は行わない。角丸加工はiOS側に任せる。

| ファイル | 形式・寸法 | 用途 |
| --- | --- | --- |
| `sekasoko_icon_temp.png` | PNG・1254×1254・1,906,841バイト | 受領原本 |
| `icon-square.png` | PNG・角丸加工なしの正方形 | 白枠除去後の派生元 |
| `apple-touch-icon.png` | PNG・180×180 | iPhoneホーム画面 |
| `favicon-32x32.png` | PNG・32×32 | ブラウザー |
| `favicon-16x16.png` | PNG・16×16 | ブラウザー |
| `favicon.ico` | ICO・16／32／48px | ブラウザー互換用 |

原本SHA-256：`5dce34ff11e80ff1a6d36705225a0b33f717b3716772ad2673939d933904c54c`

再生成は開発環境で `python3 scripts/build_icons.py`。Pillowが必要。ゲーム本体やPagesの公開処理はPillowに依存しない。`src/shell.html` から相対URLで参照し、Pagesは既存の `assets/` 配布処理で公開する。ゲーム単体を開く場合も、アイコンには同梱の `assets/icons/` が必要。

既存のiPhoneホーム画面アイコンは端末のキャッシュが残る場合がある。新しい図柄が反映されない場合は、既存ショートカットを削除してSafariから追加し直す。
