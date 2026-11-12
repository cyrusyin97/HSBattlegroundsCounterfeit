# 部署到 DigitalOcean droplet

這份文件說明怎麼把遊戲部署到一台自己的 droplet，供私人使用。

## 架構

```
你的瀏覽器 ──(SSH 通道，或 HTTPS + 密碼)──▶ droplet
                                            └─ battlegrounds 服務（systemd 管理）
                                               一個 Python 程序：uvicorn + FastAPI
                                               ├─ /api、/ws  遊戲 API
                                               ├─ /          打包好的前端（含卡圖）
                                               └─ 每個動作存檔到 /var/lib/battlegrounds/games.sqlite3
```

- **只有一個程序。** 進行中的對局放在記憶體裡，每個請求都由同一個程序處理。
- **每步存檔。** 每個動作完成後，先把整局壓縮存進 SQLite，再回應瀏覽器，約多 2 毫秒。重啟、當機、部署新版本後，下一個請求會從存檔接著玩。
- **重新整理頁面會接著玩。** 瀏覽器在 `localStorage` 記住上一局的 ID。網址帶 `?scenario=...` 時，才會開新局。
- **systemd** 負責讓程序一直跑：當掉自動重啟，開機自動啟動。
- 程序只監聽 droplet 本機的 `127.0.0.1:8000`，外部連不到。要玩的話，用下面兩種連線方式之一。

## 需求

**Droplet**
- Ubuntu 24.04，或 Debian 12 以上。需要 Python 3.11 以上，Ubuntu 22.04 的 Python 3.10 不能用。
- x86_64 架構（DigitalOcean 一般的 droplet 都是）。
- 512 MB 記憶體就夠：程式本身約 85 MB，每局進行中約 0.7 MB。
- 磁碟約 1 GB：前端加卡圖約 660 MB。
- 可以用 `ssh root@<IP>` 登入。以下用 `203.0.113.7` 代表你的 droplet IP。

**本機（這台 Mac）**
- 能正常執行 `npm run build --workspace frontend`。
- `frontend/public/assets/official/` 裡有卡圖。打包時會一起帶上去。

## 第一次部署

在專案根目錄執行，把檔案傳上去（第一次要傳約 660 MB 卡圖，會花一些時間）：

```bash
deploy/push.sh root@203.0.113.7 --first
```

接著登入 droplet，執行一次安裝腳本。它會：
- 安裝 Python。
- 建立專用的系統帳號 `battlegrounds`。
- 建立 Python 虛擬環境並安裝套件。
- 註冊並啟動 systemd 服務。

```bash
ssh root@203.0.113.7 'bash /opt/battlegrounds/deploy/setup.sh'
```

最後看到 `Game server is running on 127.0.0.1:8000.` 就完成了。

## 連線遊玩

### 方式 A：SSH 通道（建議，完全不對外公開）

在本機開一個終端機，執行下面這行，並讓它一直開著：

```bash
ssh -N -L 8000:127.0.0.1:8000 root@203.0.113.7
```

然後用瀏覽器打開 http://localhost:8000 。

原理：SSH 把你本機的 8000 埠，經過加密連線轉到 droplet 上的 8000 埠。droplet 不需要開放任何新的埠，網路上的其他人完全看不到這個遊戲。關掉這個終端機，通道就斷了。

### 方式 B：網域 + HTTPS + 密碼

如果你想直接在任何瀏覽器（包括手機）打開，不想每次開 SSH 通道：

1. 準備一個網域，在 DNS 加一筆 A 記錄指向 droplet IP，例如 `game.example.com`。
2. 依照 Caddy 官方文件在 droplet 安裝 Caddy：https://caddyserver.com/docs/install#debian-ubuntu-raspbian
3. 在 droplet 上執行 `caddy hash-password`，輸入你要的密碼，複製輸出的雜湊值。
4. 編輯 `deploy/Caddyfile`：把網域換成你的，把雜湊值貼到 `player` 後面。`player` 是登入用的帳號名稱，可以改。
5. 複製到 droplet 並重新載入：
   ```bash
   scp deploy/Caddyfile root@203.0.113.7:/etc/caddy/Caddyfile
   ```
   ```bash
   ssh root@203.0.113.7 'systemctl reload caddy'
   ```
6. 如果 droplet 有防火牆（DigitalOcean Cloud Firewall 或 `ufw`），開放 80 和 443 埠。

Caddy 會自動申請 HTTPS 憑證，瀏覽器打開網域時會要求輸入帳號密碼。

**注意：** 方式 B 會讓這個網址出現在網路上，只是有密碼保護。建置裡含有官方卡圖，所以帳號密碼不要分享給別人。如果以後要公開給其他人玩，前端要改成不含官方卡圖的建置。

## 更新版本

改完程式碼後，在本機執行：

```bash
deploy/push.sh root@203.0.113.7
```

它會：
1. 在本機重新打包前端。
2. 只上傳有變動的檔案。
3. 在 droplet 上安裝新的 Python 套件。
4. 重啟服務。

**進行中的對局不會遺失。** 重啟後，瀏覽器的下一次點擊會從存檔接著玩。

## 日常操作（在 droplet 上執行）

| 要做什麼 | 指令 |
|---|---|
| 看服務是否在跑 | `systemctl status battlegrounds` |
| 即時看日誌 | `journalctl -u battlegrounds -f` |
| 看最近的錯誤 | `journalctl -u battlegrounds -p err -n 50` |
| 重啟 | `systemctl restart battlegrounds` |
| 停止 | `systemctl stop battlegrounds` |
| 存檔位置 | `/var/lib/battlegrounds/games.sqlite3` |

## 存檔的保留規則

設定在 `backend/main.py` 最上面：

| 情況 | 處理方式 |
|---|---|
| 一局閒置 30 分鐘 | 從記憶體移除，存檔保留。下次點擊時自動從存檔載入 |
| 一局已結束（遊戲結束，或你被淘汰） | 最後一個動作 1 小時後刪除存檔 |
| 一局未結束，但很久沒動 | 7 天後刪除。可用環境變數 `BG_IDLE_DAYS` 調整 |

清理每 5 分鐘執行一次。

## 本機模擬部署

`.claude/launch.json` 裡的 `server` 設定，會用和 droplet 相同的方式啟動：
- 單一程序，連前端一起提供。
- 存檔到 `work/server/games.sqlite3`。
- 網址是 http://localhost:8002 。

本機開發用的 `backend`（8000 埠）沒有設定 `BG_SAVE_PATH`，所以不存檔，行為跟以前一樣。

## 環境變數

| 變數 | 作用 | 未設定時 |
|---|---|---|
| `BG_SAVE_PATH` | SQLite 存檔路徑 | 不存檔，對局只在記憶體裡，重啟就沒了 |
| `BG_STATIC_DIR` | 要一起提供的前端目錄 | 只提供 API（開發時由 Vite 提供前端） |
| `BG_IDLE_DAYS` | 未結束對局保留天數 | 7 |

## 重新編譯 Linux 版引擎

`vendor/wheels/` 裡的 `manylinux_2_17_x86_64` wheel，是在這台 Mac 上交叉編譯的，原始碼指紋和 macOS 版相同（`10fc8423c2f7d6ca`）。引擎原始碼改動後，要重新編譯：

```bash
. /Users/cyrusyin/Documents/Codex/2026-11-03/di/work/activate-test-env.sh
export CARGO_HOME="$PWD/work/combat-build/cache" PATH="$PWD/work/combat-build/zig-venv/bin:$PATH"
cd work/combat-engine
../combat-build/maturin build --release --offline --zig --target x86_64-unknown-linux-gnu --compatibility manylinux2014 -o ../combat-build/linux-wheels
```

- 需要 Rust 的 `x86_64-unknown-linux-gnu` target（已用 `rustup target add` 安裝）。
- 需要 `work/combat-build/zig-venv` 裡的 `ziglang`，當作交叉編譯的連結器。
- 編譯完把 wheel 複製到 `vendor/wheels/`，更新兩個 requirements 檔裡的檔名，以及 `vendor/taverngym/build-manifest.json` 的 SHA-256。
