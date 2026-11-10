// Traditional Chinese UI text, with Taiwan wording.
import type { Messages } from './zh-CN.ts';

const stars = (n: number) => '★'.repeat(n);

export const zhTW: Messages = {
  title: '爐石酒館 · 本機戰棋',
  board: '酒館棋盤',
  menu: { newGame: '開始新對局', restart: '重開', restartTitle: '重新開局', language: '語言' },
  scenarios: {
    target: '定向施法', recruit: '招募練習', triple: '三連發現', collision: '碰撞傷害', deathrattle: '亡語戰鬥',
    reborn: '復生戰鬥', hero_damage: '英雄受傷', mechanics: '機制測試', late: '中盤對局', random: '隨機對局',
  },
  regions: { roster: '玩家列表', hero: '我方英雄', enemyHero: '敵方英雄' },
  phase: {
    heroSelect: turn => `選擇英雄 · 第 ${turn} 回合`,
    recruit: turn => `招募 · 第 ${turn} 回合`,
    over: turn => `對局結束 · 第 ${turn} 回合`,
    combat: turn => `戰鬥 · 第 ${turn} 回合`,
  },
  gold: n => `◉ ${n} 金幣`,
  tier: n => `酒館等級 ${n}`,
  tools: {
    upgrade: price => `升級 ${price}`,
    refresh: price => `⟳ 刷新 ${price}`,
    freeze: '❄ 凍結',
    unfreeze: '❄ 解凍',
    darkGift: cost => `黑暗之賜 ${cost}`,
    darkGiftHelp: (cost, left, max) =>
      `黑暗之賜 · 花費 ${cost} 枚鑄幣，從三張各帶一個不同黑暗之賜的隨從中發現一張。每回合一次，本局還剩 ${left}/${max} 次。`,
    endTurn: '結束回合',
    cancel: '取消',
  },
  status: {
    loading: '酒館準備中…',
    offline: '無法連線到遊戲服務，請啟動後端並點擊重開',
    resolving: '正在結算…',
    disconnected: '連線中斷，請檢查服務後重試',
    rejected: '操作未生效，已同步棋盤',
    resynced: '已重新讀取對局狀態',
    idle: '拖進手牌購買 · 拖到戰團出牌 · 拖回酒館出售',
    over: place => `對局結束 · 第 ${place} 名`,
    target: '請選擇目標 · 右鍵取消',
    discard: '選擇一張手牌棄掉 · 右鍵取消',
    join: '　',
  },
  drop: {
    buy: '放開購買', sell: '放開出售', cast: '放開施法', move: '放開確認站位', play: '放開出牌', magnetize: '放開磁力吸附',
    confirm: '放開確認', seek: '移到合法位置，或放開返回', invalid: '無法放置，已返回原位',
  },
  choice: {
    heroSelect: '選擇英雄',
    chooseOne: name => `抉擇 · ${name}`,
    darkGift: '黑暗之賜 · 選擇一張隨從',
    generic: '請選擇一項',
    fold: '收起 ▴',
    unfold: '展開 ▾',
    mode: index => (index === 0 ? '選項一' : '選項二'),
    option: n => `選項 ${n}`,
  },
  card: {
    spell: '法術',
    line: (name, text) => (text ? `${name} · ${text}` : name),
    attached: (darkGift, name, text) => `${darkGift ? '黑暗之賜' : '附加'} · ${text ? `${name}：${text}` : name}`,
  },
  player: {
    picking: '選擇英雄中',
    header: (rank, name, tags) => `第 ${rank} 名 · ${name}${tags.length ? `（${tags.join('，')}）` : ''}`,
    you: '你',
    next: '下一個對手',
    out: '已出局',
    stats: (tier, health, armor) => `酒館 ${stars(tier)} · 生命 ${health} · 護甲 ${armor}`,
    streak: n => `連勝 ${n} 場`,
    lastCombat: damage => `上次交戰${damage > 0 ? '造成' : '受到'} ${Math.abs(damage)} 點傷害`,
    warband: (tribe, size) => `陣容 · ${tribe}（${size} 個隨從）`,
    noWarband: '陣容 · 無隨從',
    power: (name, text) => `英雄技能 · ${name}：${text}`,
    trinket: (name, text) => `飾品 · ${name}：${text}`,
    noTrinket: '飾品 · 無',
    label: (rank, you, name, armor, health, tribe) =>
      `第 ${rank} 名，${you ? '你，' : ''}${name}，護甲 ${armor}，生命 ${health}${tribe ? `，陣容${tribe}` : ''}`,
  },
  hero: { ghost: '幽靈', fallback: '英雄' },
  combat: {
    fighting: '交戰中',
    draw: '戰鬥平手',
    won: damage => `戰鬥勝利 · ${damage} 點傷害`,
    lost: damage => `戰鬥落敗 · ${damage} 點傷害`,
    blocked: '抵擋',
  },
  tribes: {
    BEAST: '野獸', DEMON: '惡魔', DRAGON: '龍', ELEMENTAL: '元素', MECHANICAL: '機械', MURLOC: '魚人',
    NAGA: '納迦', PIRATE: '海盜', QUILBOAR: '野豬人', UNDEAD: '亡靈', ABERRATION: '畸變怪',
  },
  tribeMixed: '混合',
  tribeNone: '無種族',
  chooseOne: { prefix: /^\s*抉[择擇][：:]\s*/, separator: '；或者' },
};
