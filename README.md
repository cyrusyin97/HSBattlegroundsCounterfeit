# cloneBattlegrounds

本地酒馆战棋 POC。本地服务通过 TavernGym 处理真人操作和七个机器人座位。前端可通过 HTTP 或 WebSocket 获取玩家视图和战斗回放。

## 技术栈

| 层 | 依赖 |
| --- | --- |
| 引擎 | TavernGym 1.0.0，目标客户端 36.6.3.253932 / 规则 36.6.3 |
| 本地服务 | Python 3.11、FastAPI、Uvicorn、WebSocket |
| 图形前端 | TypeScript、Three.js、Vite |
| 验证工具 | pytest、httpx2、TypeScript 类型检查 |

已验证环境：macOS arm64，Python 3.11.15，Node.js 25.6.1，npm 11.9.0。

## 目录

```text
backend/             游戏会话、FastAPI 入口、接口测试与依赖清单
frontend/            npm workspace、TypeScript 与 Vite 配置
vendor/wheels/       验证过的 TavernGym 原生安装包
vendor/taverngym/    上游许可证、NOTICE 和构建来源清单
.venv/               项目专属 Python 环境（Git 忽略）
work/                安装日志与缓存（Git 忽略）
```

## 安装与复现

从仓库根目录运行，Python 应为 3.11：

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm ci
```

`backend/requirements.txt` 锁定全部已安装 Python 依赖；其中 wheel 路径相对仓库根目录。`backend/requirements.in` 记录直接依赖，用于有意升级时重新解析。npm 的精确直接依赖和完整依赖树分别保存在 `frontend/package.json` 与 `package-lock.json`。

该 wheel 适用于 macOS Apple Silicon。Windows、Linux 或 Intel Mac 需要另行构建对应 wheel，并更新 Python 依赖清单。已安装的 wheel 运行时不需要 Rust 编译器和 AutoTavern 源码目录。

## 检查

```sh
.venv/bin/python -m pip check
npm run check:frontend
.venv/bin/python -c 'import taverngym; print(taverngym.game_version())'
```

## 本地游戏接口

从仓库根目录启动单进程服务，打开 http://127.0.0.1:8000/docs 可查看 HTTP 接口。

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

| 操作 | 入口 |
| --- | --- |
| 创建八人对局 | `POST /api/games`，返回初始快照和 `game_id` |
| 重连或读取快照 | `GET /api/games/{game_id}` |
| 提交一个玩家动作 | `POST /api/games/{game_id}/actions` |
| WebSocket | `/ws/games/{game_id}`，连接时发送快照，之后每次提交动作返回一次结果 |

本地玩家控制座位 0。在需要等待其他座位时服务驱动机器人，直到玩家再次可以操作、被淘汰或游戏结束。对局和请求去重记录保存在当前进程内，重启服务后重新开局。HTTP 与 WebSocket 共用会话和版本号。

```ts
import { createGame, makeRequest, submitAction } from './game-api';

const initial = await createGame();
const choice = initial.legal_actions.find(action => action.kind === 'choose')!;
const request = makeRequest(initial, choice);
const next = await submitAction(initial.game_id, request);
// next.state.me.pending 可能包含英雄选择触发的另一项决定。
```

从最新快照的 `legal_actions` 中选取动作，附上这份快照的 `version` 和新生成的 `request_id`。网络重试时重用完整请求。服务只接受与当前合法列表完全相同的动作对象。购买使用商店卡的 `sid`，出牌使用手牌的 `hid`，出售与站位使用场上实例的 `eid`。落点 `position` 和选项 `option` 从 0 开始。指定目标的法术先提交 `cast`，再根据新的合法列表提交 `target` 或 `cancel`。

成功后 `ok=true`，版本增加 1，响应包含结算后的玩家视图、合法操作和最近一次本方战斗。重复提交返回 HTTP 409 和 `duplicate_request`，其中 `error.applied_version` 是原请求生效的版本。版本过期返回 409 和 `stale_version`，非法游戏动作返回 422 和 `illegal_action`。这些响应都带当前快照。请求格式错误由 HTTP 422 或 WebSocket 的 `invalid_request` 表示。WebSocket 使用同一套游戏结果和错误码。客户端处理来自多条连接的响应时，以较新的版本更新画面。

战斗记录见 `combat`。首次战斗前为 `null`，同一份回放可能出现在多次读取中，客户端按 `(game_id, combat.turn)` 去重。双方顺序由 `a` 和 `b` 映射，`winner` 是战斗侧别，2 表示平局。每帧的 `attacks` 给出有序的攻击者和目标实体 ID，`boards` 给出该帧结算后的棋盘。原始调试视图中的其他座位实时棋盘与无关战斗记录仅留在服务端。

验证接口和前端类型：

```sh
.venv/bin/python -m pytest -q
npm run check:frontend
```

Vite 开发代理已将 `/api` 和 `/ws` 指向本地 8000 端口。TypeScript 客户端位于 `frontend/src/game-api.ts`。

## 引擎来源

- 上游：<https://github.com/MCG-NJU/AutoTavern>
- commit：`fb61201a557ddd36a411cf44aac51ce4d9b606ce`
- 源码构建指纹：`c807e9aa1a6746ee`
- SHA-256 与原平台验证结果见 `vendor/taverngym/build-manifest.json`。
- 许可证及第三方内容说明见 `vendor/taverngym/LICENSE` 与 `vendor/taverngym/NOTICE`。

官方素材的本地缓存预留在 `frontend/public/assets/official/`，该目录已加入 Git 忽略规则。

## 固定演示场景

启动后在 /docs 中展开 `POST /api/games`，填写下表的 `scenario`，即可从招募阶段开始。每次创建都是独立对局。也可以从项目根目录运行：

```sh
curl http://127.0.0.1:8000/api/scenarios
curl -X POST 'http://127.0.0.1:8000/api/games?scenario=deathrattle'
```

| scenario | 操作与预期 |
| --- | --- |
| recruit | 买南海卖艺者，打到愤怒编织者右侧，再移到左侧 |
| target | 使用香蕉果盘，选中无害的骨颅，攻击力和生命值各加 2 |
| triple | 买第三张愤怒编织者，打出金色随从，使用三连奖励，再从三张候选中选一张 |
| deathrattle | 提交 end_turn，回放五帧，包含破盾、亡语召唤两个骷髅和风怒连击 |
| reborn | 提交 end_turn，对照复活的骑兵前后的实体 ID、生命值和复生关键词 |

前端调用 `createGame('target')` 等方法创建场景，后续沿用普通游戏的动作接口。场景锁定种子 17，采用引擎生成的初始商店，通过调试接口预置演示随从和法术。开场预置的场上随从不占用共享池副本，亡语和复生场景还预设了对手的身材。第一回合其他座位已结束招募，下一回合恢复普通机器人逻辑。

### 本地测试贴图

`frontend/src/demo-art.json` 按引擎卡牌 ID 保存官网数字 ID、来源、尺寸和 SHA-256。图片来自抓取日的国服卡牌库，卡面可能印有其他补丁的数值，游戏逻辑和实时展示数值应取自玩家快照。图片仅作个人本地测试，缓存目录已加入 Git 忽略规则。在另一份工作副本中从根目录恢复缓存：

```sh
.venv/bin/python scripts/restore_demo_art.py
```

前端按可见卡牌的引擎 ID 加载本地 PNG。普通版与金色版分别匹配，缺图时显示占位图。清单包含整个引擎卡表，包括英雄、技能、法术、饰品与衍生牌。有完整卡面的条目记录 `source` 与 `sha256`，来自官方补丁公告的卡面另外记录 `source_page`。使用打包版棋盘时，在恢复缓存后运行 `npm run build --workspace frontend` 将图片复制到发布目录。

## 打开棋盘

在项目根目录打开两个终端，分别运行：

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
npm run dev --workspace frontend
```

打开 http://127.0.0.1:5173/ 进入木质酒馆。左上角可切换固定场景或创建随机对局。将商店随从拖到手牌购买，再拖到友方战团出牌；在战团内拖动调整站位，拖回商店出售。点击法术后选择描边目标，Esc 取消。结束回合后棋盘自动播放引擎记录的本方战斗，再进入下一次决策。未缓存的卡图显示占位图，名称、效果与攻防仍来自引擎。

「碰撞伤害」场景首击由 58/154 与 100/106 的随从交锋。双方伤害星标与红色血量在接触时同步更新，结算后再淡出阵亡随从。圣盾吸收时显示「抵挡」。当前依赖锁定本地回放扩展 `1.0.0+impact2`，升级旧环境后需重启后端加载新 wheel。构建其他平台的 wheel 时，先在上述上游 commit 应用 `vendor/taverngym/attack-impact.patch`，再按上游流程构建。旧格式回放仅播放位移。

「英雄受伤」场景预置己方 1 点护甲。结束回合后，敌方英雄造成 2 点伤害，护甲降到 0、血量从 30 降到 29。战斗回放的 heroes_before / heroes_after 记录结算前后英雄状态，包含护甲吸收、伤害抵挡与结算触发效果。旧回放缺少该字段时保留胜负表现，并通过后续快照同步数值。

招募操作造成的英雄护甲与血量变化即时播放。战斗内技能造成的英雄数值变化目前在随从战斗结束后统一呈现，随后播放胜方英雄攻击与战后伤害结算。
