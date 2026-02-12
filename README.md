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
