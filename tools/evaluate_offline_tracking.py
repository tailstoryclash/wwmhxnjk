# evaluate_offline_tracking.py
"""Held-out synthetic trajectory evaluation, not detector accuracy or game testing."""
import argparse
import csv
import json
import math
from pathlib import Path
import time
import numpy as np
from offline_tracking import Tracker


def trajectory(stamp, kind, angle):
    stamp = np.asarray(stamp)
    if kind == 'velocity':
        return np.stack((80 * stamp, -30 * stamp), axis=-1)
    if kind == 'acceleration':
        return np.stack((30 * stamp + 15 * stamp ** 2, -20 * stamp + 6 * stamp ** 2), axis=-1)
    if kind == 'turns':
        period = np.mod(stamp + angle, 4)
        return np.stack((100 * (2 - np.abs(period - 2)), 60 * np.sin(stamp * 1.7 + angle)), axis=-1)
    return np.stack((100 * np.cos(stamp * 1.8 + angle), 70 * np.sin(stamp * 2.3)), axis=-1)


def evaluate(seed, output_dir):
    rng = np.random.default_rng(seed)
    output_dir.mkdir(parents=True, exist_ok=False)
    summaries = []
    with (output_dir / 'predictions.csv').open('x', newline='') as raw:
        writer = csv.writer(raw)
        writer.writerow(('seed', 'trajectory', 'noise_px', 'method', 'timestamp_s', 'horizon_s', 'observed', 'actual_x', 'actual_y', 'predicted_x', 'predicted_y'))
        for kind in ('velocity', 'acceleration', 'turns', 'oscillation'):
            stamps = np.cumsum(rng.uniform(.008, .025, 720))
            angle = float(rng.uniform(0, 6))
            truth = trajectory(stamps, kind, angle)
            for noise in (4., 12.):
                measurements = truth + rng.normal(0, noise, truth.shape)
                observed = (rng.random(len(stamps)) > .1) & ~((stamps > 4) & (stamps < 4.8))
                for method in Tracker.METHODS:
                    tracker = Tracker(method, noise_px=noise)
                    errors = {h: [] for h in (0., .016, .033, .05, .1)}
                    latencies = []
                    unavailable = 0
                    for index, stamp in enumerate(stamps):
                        started = time.perf_counter_ns()
                        tracker.update(float(stamp), measurements[index] if observed[index] else None, quality=.8)
                        forecasts = [(h, tracker.predict(h)) for h in errors]
                        latencies.append((time.perf_counter_ns() - started) / 1000)
                        if index < 60:
                            continue
                        for horizon, forecast in forecasts:
                            if forecast is None:
                                unavailable += 1
                                continue
                            actual = trajectory(stamp + horizon, kind, angle)
                            errors[horizon].append(forecast - actual)
                            writer.writerow((seed, kind, noise, method, stamp, horizon, int(observed[index]), *actual, *forecast))
                    for horizon, residuals in errors.items():
                        residual = np.asarray(residuals)
                        summaries.append(dict(seed=seed, trajectory=kind, noise_px=noise, method=method, horizon_s=horizon,
                            samples=len(residual), coordinate_mae_px=float(np.mean(np.abs(residual))),
                            coordinate_rmse_px=float(np.sqrt(np.mean(residual ** 2))),
                            mean_distance_px=float(np.mean(np.linalg.norm(residual, axis=1))),
                            max_distance_px=float(np.max(np.linalg.norm(residual, axis=1))),
                            step_five_forecasts_us_p50=float(np.quantile(latencies, .5)),
                            step_five_forecasts_us_p99=float(np.quantile(latencies, .99)), resets=tracker.resets,
                            unavailable_forecasts=unavailable))
    result = dict(seed=seed, scope='synthetic, pixels, varying dt, 10 percent dropout and 0.8s loss; no real offline logs',
                  ml='not trained or selected; no validated representative training/evaluation data', results=summaries)
    (output_dir / 'summary.json').write_text(json.dumps(result, indent=2, allow_nan=False))
    print(json.dumps(dict(seed=seed, summaries=len(summaries), output=str(output_dir))))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    arguments = parser.parse_args()
    evaluate(arguments.seed, arguments.output_dir)
