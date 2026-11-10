"""Fixed-seed evaluation of a bot policy against the engine's built-in bot (docs/BOTS.md).

For each seed, a baseline game has eight built-in bots, and a challenger game puts the policy
in seat `seed % 8` with built-in bots elsewhere. Comparing the same seat on the same seed
removes much of the luck of heroes and shops.

    .venv/bin/python -m backend.evaluate --policy random --games 200 --jobs 4
"""
import argparse
import json
import math
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import taverngym

from backend.bots import POLICIES, SeatStats, make_policy, play_to_end


def evaluate_seed(policy: str, seed: int) -> dict:
    seat = seed % 8
    result = {"seed": seed, "seat": seat}
    try:
        baseline = taverngym.Game(seed=seed)
        play_to_end(baseline)
        game = taverngym.Game(seed=seed)
        stats: dict[int, SeatStats] = {}
        play_to_end(game, {seat: make_policy(policy, seed)}, stats)
    except Exception as error:  # Reported per seed so one failure does not stop the run.
        return {**result, "error": f"{type(error).__name__}: {error}"}
    record = stats.get(seat, SeatStats())
    return {
        **result,
        "baseline": baseline.placements()[seat],
        "placement": game.placements()[seat],
        "turns": game.turn,
        "decisions": record.decisions,
        "fallbacks": dict(record.fallbacks),
        "latencies": record.latencies,
        "truncated_combats": game.truncated_combats,
        "turn_limit": bool(game.turn_limit_end),
    }


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * len(ordered)))]


def summarize(policy: str, results: list[dict], seconds: float) -> dict:
    played = [r for r in results if "error" not in r]
    diffs = [r["placement"] - r["baseline"] for r in played]
    latencies = [x for r in played for x in r["latencies"]]
    decisions = sum(r["decisions"] for r in played)
    fallbacks = {}
    for r in played:
        for cause, count in r["fallbacks"].items():
            fallbacks[cause] = fallbacks.get(cause, 0) + count
    mean = lambda values: statistics.fmean(values) if values else None  # noqa: E731
    spread = 1.96 * statistics.stdev(diffs) / math.sqrt(len(diffs)) if len(diffs) > 1 else None
    ms = lambda value: None if value is None else round(value * 1000, 2)  # noqa: E731
    return {
        "policy": policy,
        "games": len(results),
        "errors": [r for r in results if "error" in r],
        "placement": mean([r["placement"] for r in played]),
        "baseline_placement": mean([r["baseline"] for r in played]),
        "difference": mean(diffs),
        "difference_95": spread,
        "top4_rate": mean([r["placement"] <= 4 for r in played]),
        "baseline_top4_rate": mean([r["baseline"] <= 4 for r in played]),
        "win_rate": mean([r["placement"] == 1 for r in played]),
        "decisions": decisions,
        "fallbacks": fallbacks,
        "fallback_rate": sum(fallbacks.values()) / decisions if decisions else None,
        "latency_ms_p50": ms(percentile(latencies, 0.5)),
        "latency_ms_p95": ms(percentile(latencies, 0.95)),
        "truncated_combats": sum(r["truncated_combats"] for r in played),
        "turn_limit_games": sum(r["turn_limit"] for r in played),
        "seconds": round(seconds, 2),
        "results": [{k: v for k, v in r.items() if k != "latencies"} for r in results],
    }


def run(policy: str, games: int, first_seed: int = 0, jobs: int = 1) -> dict:
    seeds = range(first_seed, first_seed + games)
    start = time.perf_counter()
    if jobs > 1:
        with ProcessPoolExecutor(jobs) as pool:
            results = list(pool.map(evaluate_seed, [policy] * games, seeds))
    else:
        results = [evaluate_seed(policy, seed) for seed in seeds]
    return summarize(policy, results, time.perf_counter() - start)


def describe(report: dict) -> str:
    def number(value, digits=2):
        return "n/a" if value is None else f"{value:.{digits}f}"
    interval = "" if report["difference_95"] is None else f" ± {report['difference_95']:.2f}"
    fallbacks = ", ".join(f"{cause} {count}" for cause, count in sorted(report["fallbacks"].items())) or "none"
    return "\n".join([
        f"Policy {report['policy']} · {report['games']} games · {report['seconds']} s",
        f"  Mean placement     {number(report['placement'])}  (built-in in the same seats {number(report['baseline_placement'])})",
        f"  Paired difference  {number(report['difference'])}{interval}  (negative is better)",
        f"  Top 4              {number(report['top4_rate'])}  (built-in {number(report['baseline_top4_rate'])})",
        f"  First place        {number(report['win_rate'])}",
        f"  Decisions          {report['decisions']}  · fallbacks: {fallbacks}",
        f"  Latency p50 / p95  {report['latency_ms_p50'] if report['latency_ms_p50'] is not None else 'n/a'}"
        f" / {report['latency_ms_p95'] if report['latency_ms_p95'] is not None else 'n/a'} ms",
        f"  Engine guards      truncated combats {report['truncated_combats']}, turn-limit games {report['turn_limit_games']},"
        f" errors {len(report['errors'])}",
    ])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Compare a bot policy with the built-in bot on fixed seeds.")
    parser.add_argument("--policy", required=True, choices=sorted(POLICIES))
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--seed", type=int, default=0, help="first seed")
    parser.add_argument("--jobs", type=int, default=1, help="worker processes")
    parser.add_argument("--out", help="write the full report as JSON")
    args = parser.parse_args(argv)
    report = run(args.policy, args.games, args.seed, args.jobs)
    print(describe(report))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as file:
            json.dump(report, file, indent=2)
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
