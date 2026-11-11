// Simplified Chinese UI text. This is the source catalog: its shape defines `Messages`,
// and the other locales must provide every key.

const stars = (n: number) => '★'.repeat(n);

export const zhCN = {
  title: '炉石酒馆 · 本地战棋',
  board: '酒馆棋盘',
  menu: { newGame: '开始新对局', restart: '重开', restartTitle: '重新开局', language: '语言' },
  scenarios: {
    target: '定向施法', recruit: '招募练习', triple: '三连发现', collision: '碰撞伤害', deathrattle: '亡语战斗',
    reborn: '复生战斗', hero_damage: '英雄受伤', mechanics: '机制测试', late: '中盘对局', showcase: '特效展示', random: '随机对局',
  } as Record<string, string>,
  regions: { roster: '玩家列表', hero: '己方英雄', enemyHero: '对方英雄' },
  phase: {
    heroSelect: (turn: number) => `选择英雄 · 第 ${turn} 回合`,
    recruit: (turn: number) => `招募 · 第 ${turn} 回合`,
    over: (turn: number) => `对局结束 · 第 ${turn} 回合`,
    combat: (turn: number) => `战斗 · 第 ${turn} 回合`,
  },
  gold: (n: number) => `◉ ${n} 金币`,
  tier: (n: number) => `酒馆等级 ${n}`,
  tools: {
    upgrade: (price: number) => `升本 ${price}`,
    refresh: (price: number) => `⟳ 刷新 ${price}`,
    freeze: '❄ 冻结',
    unfreeze: '❄ 解冻',
    darkGift: (cost: number) => `黑暗之赐 ${cost}`,
    darkGiftHelp: (cost: number, left: number, max: number) =>
      `黑暗之赐 · 花费${cost}枚铸币，从三张各带一个不同黑暗之赐的随从中发现一张。每回合一次，本局还剩 ${left}/${max} 次。`,
    endTurn: '结束回合',
    cancel: '取消',
  },
  status: {
    loading: '酒馆准备中…',
    offline: '无法连接游戏服务，请启动后端并点击重开',
    resolving: '正在结算…',
    disconnected: '连接中断，请检查服务后重试',
    rejected: '操作未生效，已同步棋盘',
    resynced: '已重新读取对局状态',
    idle: '拖入手牌购买 · 拖至战团出牌 · 拖回酒馆出售',
    over: (place: number) => `对局结束 · 第 ${place} 名`,
    target: '请选择目标 · 右键取消',
    discard: '选择一张手牌弃掉 · 右键取消',
    /** Joins the casting card's name and text with the target prompt. */
    join: '　',
  },
  drop: {
    buy: '松手购买', sell: '松手出售', cast: '松手施法', move: '松手确认站位', play: '松手出牌', magnetize: '松手磁力吸附',
    confirm: '松手确认', seek: '移至合法落点，或松手返回', invalid: '无法放置，已返回原位',
  } as Record<string, string>,
  choice: {
    heroSelect: '选择英雄',
    chooseOne: (name: string) => `抉择 · ${name}`,
    darkGift: '黑暗之赐 · 选择一张随从',
    generic: '请选择一项',
    fold: '收起 ▴',
    unfold: '展开 ▾',
    mode: (index: number): string => (index === 0 ? '选项一' : '选项二'),
    option: (n: number) => `选项 ${n}`,
  },
  card: {
    spell: '法术',
    line: (name: string, text: string) => (text ? `${name} · ${text}` : name),
    attached: (darkGift: boolean, name: string, text: string) =>
      `${darkGift ? '黑暗之赐' : '附加'} · ${text ? `${name}：${text}` : name}`,
  },
  player: {
    picking: '选将中',
    header: (rank: number, name: string, tags: string[]) =>
      `第 ${rank} 名 · ${name}${tags.length ? `（${tags.join('，')}）` : ''}`,
    you: '你',
    next: '下一个对手',
    out: '已出局',
    stats: (tier: number, health: number, armor: number) => `酒馆 ${stars(tier)} · 生命 ${health} · 护甲 ${armor}`,
    streak: (n: number) => `连胜 ${n} 场`,
    lastCombat: (damage: number) => `上次交战${damage > 0 ? '造成' : '受到'} ${Math.abs(damage)} 点伤害`,
    warband: (tribe: string, size: number) => `阵容 · ${tribe}（${size} 个随从）`,
    noWarband: '阵容 · 无随从',
    power: (name: string, text: string) => `英雄技能 · ${name}：${text}`,
    trinket: (name: string, text: string) => `饰品 · ${name}：${text}`,
    noTrinket: '饰品 · 无',
    label: (rank: number, you: boolean, name: string, armor: number, health: number, tribe?: string) =>
      `第 ${rank} 名，${you ? '你，' : ''}${name}，护甲 ${armor}，生命 ${health}${tribe ? `，阵容${tribe}` : ''}`,
  },
  hero: { ghost: '幽灵', fallback: '英雄' },
  combat: {
    fighting: '交战中',
    draw: '战斗平局',
    won: (damage: number) => `战斗胜利 · ${damage} 点伤害`,
    lost: (damage: number) => `战斗落败 · ${damage} 点伤害`,
    blocked: '抵挡',
  },
  tribes: {
    BEAST: '野兽', DEMON: '恶魔', DRAGON: '龙', ELEMENTAL: '元素', MECHANICAL: '机械', MURLOC: '鱼人',
    NAGA: '纳迦', PIRATE: '海盗', QUILBOAR: '野猪人', UNDEAD: '亡灵', ABERRATION: '畸变怪',
  } as Record<string, string>,
  tribeMixed: '混合',
  tribeNone: '无种族',
  /** How a Choose One card's text introduces and separates its two modes. */
  chooseOne: { prefix: /^\s*抉择[：:]\s*/, separator: '；或者' },
};

export type Messages = typeof zhCN;
