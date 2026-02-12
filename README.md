# Compose BOM Mapper

Android Compose BOM のマッピングデータを使い、2つのBOMバージョンの差分を比較するシンプルなWebサイトです。

## 使い方

1. ローカルサーバを起動（Node.js 18+）

```bash
node server.mjs
```

2. ブラウザで `http://localhost:5173` を開く
3. 「データ取得」を押してBOMデータを読み込む
4. 比較元・比較先のBOMを選択し、「比較する」を押す

## 備考

- ブラウザから外部URLへ直接アクセスせず、`server.mjs` がサーバー側で取得するため CORS の影響を受けません。
- 取得元は Android Developers のURLを優先し、失敗時は Maven Central の BOM POM から復元します。

## `bom-mapping.md` について

- `bom-mapping.md` は検証用のローカル保存データです。本番の取得処理では直接参照しません。
- `bom-mapping.md` を使って検証する場合は、対象URL先の内容を自分でダウンロードし、プロジェクトルートに `bom-mapping.md` として配置してください。
- 現在の実装は、`Make a selection` 行に並ぶ BOM 一覧の順序と、同一 `Library` が表に並ぶ順序を対応付けてパースします。
- 一部ライブラリは行数が BOM 数より少ないため、その場合は存在する行までを新しい BOM から順に割り当て、残りは未定義（`-` 表示）として扱います。
