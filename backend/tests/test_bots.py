import taverngym

from backend.bots import BUILTIN, Decision, DecisionContext, RandomPolicy, decide, play_to_end
from backend.evaluate import run


class Broken:
    name = "broken"

    def __init__(self, mode):
        self.mode = mode

    def choose(self, context):
        if self.mode == "error":
            raise RuntimeError("model unavailable")
        if self.mode == "illegal":
            return Decision({"kind": "buy", "shop_id": -1})
        return None


def test_random_policy_only_plays_legal_actions_and_finishes():
    game = taverngym.Game(seed=3)
    stats = {}
    play_to_end(game, {2: RandomPolicy(3)}, stats)
    assert game.is_over()
    assert stats[2].decisions > 0 and not stats[2].fallbacks


def test_failures_fall_back_to_the_builtin_choice():
    for mode, cause in (("error", "error"), ("illegal", "illegal"), ("none", "illegal")):
        game = taverngym.Game(seed=5)
        stats = {}
        assert decide(game, 1, Broken(mode), stats) == game.bot_action(1)
        assert stats[1].fallbacks == {cause: 1}


def test_slow_decisions_fall_back():
    game = taverngym.Game(seed=5)
    stats = {}
    assert decide(game, 1, RandomPolicy(0), stats, deadline=-1) == game.bot_action(1)
    assert stats[1].fallbacks == {"timeout": 1}


def test_context_shows_only_public_facts_about_opponents():
    game = taverngym.Game(seed=6)
    play_to_end_turns(game, 4)
    context = DecisionContext(game, 3)
    assert context.state["seat"] == 3
    assert all("board" not in op and "hand" not in op for op in context.state["opponents"])
    assert context.builtin_action() in context.actions
    assert decide(game, 3, BUILTIN) == game.bot_action(3)


def play_to_end_turns(game, turn):
    while game.turn < turn:
        for seat in range(game.num_players):
            if game.needs_action(seat):
                game.step(seat, game.bot_action(seat))


def test_evaluation_pairs_seats_and_seeds():
    same = run("builtin", 4)
    assert same["difference"] == 0 and not same["errors"]
    assert [r["seat"] for r in same["results"]] == [0, 1, 2, 3]
    worse = run("random", 4)
    assert worse["difference"] > 0 and worse["decisions"] > 0
