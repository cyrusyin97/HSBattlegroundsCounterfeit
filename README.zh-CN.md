# HSBattlegroundsCounterfeit

[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md)

个人自用、仅在本机运行的酒馆战棋式自走棋。你控制八人对局中的 0 号座位，对手是七个脚本机器人。本地 Python 服务通过 TavernGym 引擎结算规则，浏览器里的 Three.js 棋盘负责呈现招募、战斗回放和各种特效。

> **非官方同人项目。** 本项目与暴雪娱乐无关，未获其认可或赞助。《炉石传说》及所有卡牌名称、卡牌文字和美术均归暴雪所有。**本仓库不包含任何官方卡图。** 卡图只能恢复到 Git 忽略的目录，供个人本地测试使用，详见[卡图](#卡图)。

## 功能

- **规则引擎：** TavernGym 1.0.0（规则 36.6.3），并打了一个本地补丁，用来记录攻击命中以及战斗前后的英雄状态。
- **3D 棋盘：** Three.js 把商店、战团和手牌呈现为持续存在的卡牌对象。拖动卡牌即可购买、出牌、调整站位和出售。
- **卡面：** 程序绘制的边框，显示插图、等级星星，攻击力和生命值直接用数字显示。悬停卡牌会显示名称、效果，以及附加的卡牌（例如黑暗之赐）。
- **关键字特效：**
  - 嘲讽：卡牌后方的钢盾。
  - 圣盾：金色泡泡。
  - 潜行：深色烟雾。
  - 风怒：白色气流。
  - 复生：带裂纹的银色外壳。
  - 亡语、剧毒：卡牌上的徽记。
  - 金色随从：亮金卡身、皇冠和扫光，不依赖颜色也能辨认。
- **交互：**
  - 指向性法术拖出手牌区后变成瞄准箭头。箭头从发起选择的来源指出：手牌、随从或英雄技能。
  - 磁力随从可以吸附到机械上。
  - 弃牌效果可以选择手牌。
  - 抉择和发现面板可以收起。
  - 右键或 Esc 取消。
- **战斗回放：** 在桌面上重播引擎的战斗记录，包括扑击、伤害爆星、破盾、阵亡、召唤以及最后的英雄攻击。战斗中手牌保持可见，悬停仍会显示说明。
- **对手信息：** 左侧玩家列表按生命加护甲排名，每个头像旁标出该玩家当前阵容的种族。悬停头像会显示名次、酒馆等级、连胜、英雄技能和饰品。
- **三种语言：** 英文、简体中文和繁体中文，可以在左上角菜单切换，不必重开对局。默认跟随浏览器语言；`?lang=en`、`?lang=zh-CN` 或 `?lang=zh-TW` 可以强制指定。繁体卡牌文字由 OpenCC 从简体转换。详见 [docs/I18N.md](docs/I18N.md)。
- **固定场景：** 可以复现的对局，用来演示特定机制（见下文）。

## 环境要求

已在 macOS（Apple Silicon）、Python 3.11.15、Node.js 25.6.1、npm 11.9.0 上测试。

`vendor/wheels/` 里附带的引擎安装包只适用于 **macOS arm64**。其他平台需要自行编译引擎（见[引擎](#引擎)）。

## 安装

在仓库根目录运行：

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm ci
```

## 运行

在仓库根目录开两个终端，分别启动后端和前端：

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```sh
npm run dev --workspace frontend
```

打开 <http://127.0.0.1:5173/>。左上角的场景菜单可以开始固定场景或随机对局。API 文档位于 <http://127.0.0.1:8000/docs>。

### 操作

| 动作 | 手势 |
| --- | --- |
| 购买 | 把商店卡牌拖进手牌，或直接点击 |
| 打出随从 | 从手牌拖到战团，落点跟随指针 |
| 磁力吸附 | 把磁力随从放到高亮机械的正中 |
| 调整站位 | 在战团内拖动随从 |
| 出售 | 把随从拖回商店 |
| 施放指向性法术 | 拖出手牌区，在高亮目标上松开 |
| 发动随从或英雄技能 | 点击；需要时再选择目标 |
| 取消 | 右键、Esc 或“取消”按钮 |
| 查看说明 | 悬停卡牌或玩家头像 |

### 场景

| 场景 | 演示内容 |
| --- | --- |
| `target` | 定向施法：对随从使用香蕉果盘 |
| `recruit` | 购买、打出和调整随从站位 |
| `triple` | 三连得到金色随从，并使用三连奖励（发现） |
| `collision` | 两个大随从同时互相命中 |
| `deathrattle` | 圣盾破碎、亡语召唤和风怒 |
| `reborn` | 复生随从以 1 点生命值回归 |
| `hero_damage` | 敌方英雄击碎护甲并造成伤害 |
| `mechanics` | 第 3 回合、10 金币：磁力、黑暗之赐、抉择和弃牌发动 |
| `late` | 由机器人打到第 10 回合的对局，用来查看对手的名次、英雄技能和饰品 |

也可以通过 API 创建：`POST /api/games?scenario=deathrattle`。

## 检查

```sh
.venv/bin/python -m pytest -q
npm run check:frontend
npm run test:frontend
npm run build --workspace frontend
```

## 目录结构

```text
backend/            FastAPI 服务、游戏会话、场景和测试
frontend/src/       棋盘控制、HUD 和 API 客户端
frontend/src/core/  与渲染无关的游戏到界面逻辑（操作判定、战斗脚本、关键字），有单元测试
frontend/src/three/ Three.js 渲染：舞台、卡牌、战斗、特效、贴图
frontend/test/      前端单元测试（node --test）
scripts/            卡图恢复脚本
vendor/             引擎安装包、本地引擎补丁、许可证和 NOTICE
docs/HANDOVER.md    详细的设计与工程说明
```

## 本地 API

服务把对局保存在内存里，重启后重新开局。HTTP 和 WebSocket 共用会话与版本号。

| 用途 | 接口 |
| --- | --- |
| 列出场景 | `GET /api/scenarios` |
| 创建对局 | `POST /api/games`（可选 `?scenario=`） |
| 读取快照 | `GET /api/games/{game_id}` |
| 提交动作 | `POST /api/games/{game_id}/actions` |
| WebSocket | `/ws/games/{game_id}` |

客户端提交的动作必须原样取自最新快照的 `legal_actions`，并附上该快照的 `version` 和新生成的 `request_id`。错误码如下：

- `stale_version`：快照的 `version` 已过期。
- `duplicate_request`：`request_id` 已经用过。
- `illegal_action`：动作不在 `legal_actions` 里。

所有错误响应都附带当前快照。TypeScript 客户端位于 `frontend/src/game-api.ts`。

## 卡图

没有卡图时，卡面会退回为带底色的徽记。`frontend/src/demo-art.json` 按引擎卡牌 ID 记录官方图片来源和固定的 SHA-256。要把图片恢复到 Git 忽略的 `frontend/public/assets/official/`，供**个人本地测试**使用：

```sh
.venv/bin/python scripts/restore_demo_art.py
```

请勿提交或再分发这些图片。

## 引擎

规则来自 [MCG-NJU/AutoTavern](https://github.com/MCG-NJU/AutoTavern)（TavernGym），固定在 commit `fb61201a557ddd36a411cf44aac51ce4d9b606ce`。

- **附带的安装包：** 打过补丁的 `1.0.0+impact2` 版本。
- **引擎补丁：** `vendor/taverngym/attack-impact.patch`。
- **构建记录：** `vendor/taverngym/build-manifest.json`。

要为其他平台构建，先在该 commit 上应用补丁，再按上游流程构建，然后把 `backend/requirements.txt` 指向新的安装包。引擎采用 MIT 许可证，其中的游戏内容另由 `vendor/taverngym/NOTICE` 说明。

## 状态

这是个人使用的概念验证，没有账号、匹配或联网对战。部分引擎系统（任务、伙伴、奥秘等）目前只有通用界面。完整情况和后续规划见 `docs/HANDOVER.md`。
