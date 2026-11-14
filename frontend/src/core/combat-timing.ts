// Every duration of combat playback, in milliseconds. The combat schedule is built from
// these alone, so the same replay always plays for the same time on every device.

/** One attack when both minions are on the table. */
export const ATTACK = {
  /** The attacker rears up and lunges; contact lands at its end. */
  lunge: 450,
  /** The defender recoils from contact. */
  recoil: 310,
  /** The attacker holds the contact pose. */
  hold: 80,
  /** The attacker returns to its slot. */
  back: 330,
  /** Rest before the next attack. */
  pause: 380,
};
export const ATTACK_MS = ATTACK.lunge + ATTACK.hold + ATTACK.back + ATTACK.pause;
/** An attack whose attacker or defender is not on the table: its hits apply and the fight waits. */
export const MISSING_ATTACK_MS = 780;

/** After a step's attacks, minions that died shrink away. */
export const DEATHS_MS = 230;
/** After the boards settle: the opening step drops the enemy warband in, later summons grow in. */
export const OPENING_MS = 520;
export const SUMMONS_MS = 290;
export const SETTLE_MS = 280;

/** Hero panels after the minion fight. */
export const HERO = {
  /** Health and armor counters change: pulse 560, floating delta 850, armor shards 600. */
  vitals: 850,
  counterPulse: 560,
  delta: 850,
  shards: 600,
  portraitFlash: 560,
  /** The damage badge appears on the winner. */
  badge: 400,
  /** The winner lunges at the loser. */
  lunge: 600,
  /** Contact: burst 950, loser recoil 420, winner return 500, loser vitals 850. */
  contact: 950,
  recoil: 420,
  back: 500,
  /** The loser's portrait fades when its health reaches 0. */
  defeat: 400,
};
export const HERO_ATTACK_MS = HERO.badge + HERO.lunge + HERO.contact;
/** The result text stays before the recruit table returns. */
export const RESULT_HOLD_MS = 850;

/** Short-lived effects, skipped when playback is already past them (after a background tab). */
export const EFFECT = { label: 780, shatter: 450, flash: 200 };
/** A larger step between two frames counts as a jump: springs snap instead of easing. */
export const JUMP_MS = 250;
