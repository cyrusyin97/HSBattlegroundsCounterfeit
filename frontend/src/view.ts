// Contract between the controller (board.ts) and the card renderer (three/view.ts).
// The controller owns the snapshot, commits, HUD and hero panels; the renderer owns
// the shop, warband and hand, and turns gestures on them into commits.
import type { Action, Card, GameSnapshot } from './game-api';
import type { CombatScript } from './core/combat-script';

export type ShopAction = 'refresh' | 'freeze' | 'upgrade';
export function isShopAction(kind: Action['kind']): kind is ShopAction {
  return kind === 'refresh' || kind === 'freeze' || kind === 'upgrade';
}

export interface ViewHost {
  readonly snapshot: GameSnapshot;
  readonly busy: boolean;
  /** Resolves after the command, its playback and the re-render, or at once when rejected. */
  commit(action: Action): Promise<void>;
  message(text: string): void;
  /** Show a card's text at a board coordinate (1440 × 810), or hide the tooltip. */
  tooltip(card?: Card, x?: number, y?: number): void;
}

/** The confirmed action that produced the snapshot being rendered. */
export interface Transition { action: Action; before: GameSnapshot }

export interface CardView {
  render(transition?: Transition): void;
  /** Minion combat on the table. Hero panels and the result text belong to the controller. */
  playCombat(script: CombatScript): Promise<void>;
  shopEffect(kind: ShopAction, before: GameSnapshot, after: GameSnapshot): Promise<void>;
  /**
   * Board coordinate where the targeting arrow starts: the card that opened the choice
   * (`from`, by default the spell being cast), when it is shown.
   */
  castOrigin(from?: { zone: 'hand' | 'board'; id: number }): { x: number; y: number } | undefined;
  resize(scale: number): void;
}

