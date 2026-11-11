// English UI text.
import type { Messages } from './zh-CN.ts';

const stars = (n: number) => '★'.repeat(n);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const en: Messages = {
  title: 'Tavern · Local Battlegrounds',
  board: 'Tavern board',
  menu: { newGame: 'Start a new game', restart: 'Restart', restartTitle: 'Restart the game', language: 'Language' },
  scenarios: {
    target: 'Targeted spell', recruit: 'Recruit practice', triple: 'Triple and Discover', collision: 'Simultaneous hits',
    deathrattle: 'Deathrattle combat', reborn: 'Reborn combat', hero_damage: 'Hero damage', mechanics: 'Mechanics test',
    late: 'Mid-game', showcase: 'Effect showcase', random: 'Random game',
  },
  regions: { roster: 'Players', hero: 'Your hero', enemyHero: 'Opposing hero' },
  phase: {
    heroSelect: turn => `Choose a hero · Turn ${turn}`,
    recruit: turn => `Recruit · Turn ${turn}`,
    over: turn => `Game over · Turn ${turn}`,
    combat: turn => `Combat · Turn ${turn}`,
  },
  gold: n => `◉ ${plural(n, 'Gold', 'Gold')}`,
  tier: n => `Tavern Tier ${n}`,
  tools: {
    upgrade: price => `Upgrade ${price}`,
    refresh: price => `⟳ Refresh ${price}`,
    freeze: '❄ Freeze',
    unfreeze: '❄ Unfreeze',
    darkGift: cost => `Dark Gift ${cost}`,
    darkGiftHelp: (cost, left, max) =>
      `Dark Gift · Spend ${cost} Gold to Discover one of three minions, each with a different Dark Gift. Once per turn; ${left}/${max} uses left this game.`,
    endTurn: 'End Turn',
    cancel: 'Cancel',
  },
  status: {
    loading: 'Setting up the tavern…',
    offline: 'Cannot reach the game service. Start the backend, then press Restart.',
    resolving: 'Resolving…',
    disconnected: 'Connection lost. Check the service and try again.',
    rejected: 'That action did not apply; the board is back in sync.',
    resynced: 'Reloaded the game state.',
    idle: 'Drag to your hand to buy · to the warband to play · back to the tavern to sell',
    over: place => `Game over · Placed ${place}`,
    target: 'Choose a target · Right-click to cancel',
    discard: 'Choose a card in your hand to discard · Right-click to cancel',
    join: ' — ',
  },
  drop: {
    buy: 'Release to buy', sell: 'Release to sell', cast: 'Release to cast', move: 'Release to reposition',
    play: 'Release to play', magnetize: 'Release to magnetize',
    confirm: 'Release to confirm', seek: 'Move to a valid spot, or release to return', invalid: 'Cannot go there; returned',
  },
  choice: {
    heroSelect: 'Choose a hero',
    chooseOne: name => `Choose One · ${name}`,
    darkGift: 'Dark Gift · Choose a minion',
    generic: 'Choose one',
    fold: 'Hide ▴',
    unfold: 'Show ▾',
    mode: index => (index === 0 ? 'Option 1' : 'Option 2'),
    option: n => `Option ${n}`,
  },
  card: {
    spell: 'Spell',
    line: (name, text) => (text ? `${name} · ${text}` : name),
    attached: (darkGift, name, text) => `${darkGift ? 'Dark Gift' : 'Attached'} · ${text ? `${name}: ${text}` : name}`,
  },
  player: {
    picking: 'Choosing a hero',
    header: (rank, name, tags) => `#${rank} · ${name}${tags.length ? ` (${tags.join(', ')})` : ''}`,
    you: 'you',
    next: 'next opponent',
    out: 'eliminated',
    stats: (tier, health, armor) => `Tavern ${stars(tier)} · Health ${health} · Armor ${armor}`,
    streak: n => `${plural(n, 'win')} in a row`,
    lastCombat: damage => `Last combat: ${damage > 0 ? 'dealt' : 'took'} ${Math.abs(damage)} damage`,
    warband: (tribe, size) => `Warband · ${tribe} (${plural(size, 'minion')})`,
    noWarband: 'Warband · empty',
    power: (name, text) => `Hero Power · ${name}: ${text}`,
    trinket: (name, text) => `Trinket · ${name}: ${text}`,
    noTrinket: 'Trinkets · none',
    label: (rank, you, name, armor, health, tribe) =>
      `#${rank}, ${you ? 'you, ' : ''}${name}, armor ${armor}, health ${health}${tribe ? `, ${tribe} warband` : ''}`,
  },
  hero: { ghost: 'Ghost', fallback: 'Hero' },
  combat: {
    fighting: 'Fighting',
    draw: 'Combat tied',
    won: damage => `Victory · ${damage} damage`,
    lost: damage => `Defeat · ${damage} damage`,
    blocked: 'Blocked',
  },
  tribes: {
    BEAST: 'Beast', DEMON: 'Demon', DRAGON: 'Dragon', ELEMENTAL: 'Elemental', MECHANICAL: 'Mech', MURLOC: 'Murloc',
    NAGA: 'Naga', PIRATE: 'Pirate', QUILBOAR: 'Quilboar', UNDEAD: 'Undead', ABERRATION: 'Aberration',
  },
  tribeMixed: 'Mixed',
  tribeNone: 'No tribe',
  chooseOne: { prefix: /^\s*Choose One\s*[-–—:]\s*/i, separator: '; or ' },
};
