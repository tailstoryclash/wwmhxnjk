# track_csv.py
"""Streaming offline CSV tracking. No capture, application control or input output."""
import argparse
from collections import deque
import csv
import json
import math
from pathlib import Path
from offline_tracking import Tracker


def process(input_path, output_path, diagnostics_path, config_path):
    configuration = json.loads(config_path.read_text())
    required = {'method', 'noise_px', 'acceleration_px_s2', 'max_gap_s', 'prediction_enabled', 'horizon_s'}
    if set(configuration) != required or type(configuration['prediction_enabled']) is not bool:
        raise ValueError('Configuration fields must match the documented schema')
    horizon = float(configuration['horizon_s']) if configuration['prediction_enabled'] else 0.0
    tracker = Tracker(configuration['method'], configuration['noise_px'], configuration['acceleration_px_s2'], configuration['max_gap_s'])
    tracker.predict(horizon)
    pending = deque()
    previous_truth = None
    count = scored = unavailable = 0
    absolute = square = 0.0
    with input_path.open(newline='') as source, output_path.open('x', newline='') as destination, diagnostics_path.open('x', newline='') as diagnostics:
        reader = csv.DictReader(source)
        if not {'time_s', 'x', 'y'} <= set(reader.fieldnames or []):
            raise ValueError('Input requires time_s,x,y columns')
        has_truth = {'truth_x', 'truth_y'} <= set(reader.fieldnames)
        writer, scorer = csv.writer(destination), csv.writer(diagnostics)
        writer.writerow(('time_s', 'target_time_s', 'predicted_x', 'predicted_y', 'observed', 'identity_epoch'))
        scorer.writerow(('origin_time_s', 'target_time_s', 'predicted_x', 'predicted_y', 'truth_x', 'truth_y', 'error_x', 'error_y'))
        for row in reader:
            stamp = float(row['time_s'])
            if bool(row['x']) != bool(row['y']):
                raise ValueError('Both observation coordinates must be present or absent')
            observation = [float(row['x']), float(row['y'])] if row['x'] else None
            tracker.update(stamp, observation, float(row.get('quality') or 1))
            prediction = tracker.predict(horizon)
            count += 1
            if prediction is None:
                unavailable += 1
                writer.writerow((stamp, stamp + horizon, '', '', int(observation is not None), tracker.resets))
            else:
                writer.writerow((stamp, stamp + horizon, *prediction, int(observation is not None), tracker.resets))
                if has_truth:
                    if len(pending) >= 32768:
                        raise ValueError('Truth lookahead exceeds 32768 forecasts; check timestamps/truth gaps')
                    pending.append((stamp, stamp + horizon, prediction))
            truth = None
            if has_truth:
                if bool(row['truth_x']) != bool(row['truth_y']):
                    raise ValueError('Both truth coordinates must be present or absent')
                if row['truth_x']:
                    truth = (float(row['truth_x']), float(row['truth_y']))
                    if not all(math.isfinite(value) for value in truth):
                        raise ValueError('Truth coordinates must be finite')
            if truth is not None:
                while pending and pending[0][1] <= stamp:
                    origin, target, forecast = pending.popleft()
                    if target == stamp:
                        actual = truth
                    elif previous_truth is not None and previous_truth[0] <= target and stamp-previous_truth[0] <= configuration['max_gap_s']:
                        fraction = (target-previous_truth[0])/(stamp-previous_truth[0])
                        actual = tuple(previous_truth[1][axis] + fraction*(truth[axis]-previous_truth[1][axis]) for axis in range(2))
                    else:
                        continue
                    error = (float(forecast[0])-actual[0], float(forecast[1])-actual[1])
                    scorer.writerow((origin, target, *forecast, *actual, *error))
                    absolute += abs(error[0])+abs(error[1])
                    square += error[0]**2+error[1]**2
                    scored += 1
                previous_truth = stamp, truth
    return dict(rows=count, scored_forecasts=scored, unavailable=unavailable, unscored_tail=len(pending),
                coordinate_mae_px=absolute/(2*scored) if scored else None,
                coordinate_rmse_px=math.sqrt(square/(2*scored)) if scored else None,
                prediction_enabled=configuration['prediction_enabled'], horizon_s=horizon,
                truth_scope='Explicit truth columns only; linear interpolation within max_gap_s; not measured coordinates')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--diagnostics', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    arguments = parser.parse_args()
    print(json.dumps(process(arguments.input, arguments.output, arguments.diagnostics, arguments.config), allow_nan=False))
