# offline_soak.py
"""Wall-clock offline tracking stress test, paced at 60 Hz; no input/capture APIs."""
import argparse
import csv
import json
import math
from pathlib import Path
import time
import numpy as np
import psutil
from offline_tracking import Tracker


def truth(stamp):
    return np.array([80 * math.sin(stamp * 1.7) + 20 * stamp, 60 * math.cos(stamp * 1.3)])


def run(config, seconds, output):
    if not math.isfinite(seconds) or not .1 <= seconds <= 7200:
        raise ValueError('Duration must be finite in [.1,7200] seconds')
    configuration = json.loads(config.read_text())
    horizon = configuration['horizon_s'] if configuration['prediction_enabled'] else 0
    tracker = Tracker(configuration['method'], configuration['noise_px'], configuration['acceleration_px_s2'], configuration['max_gap_s'])
    tracker.predict(horizon)
    rng = np.random.default_rng(20261109)
    output.mkdir(parents=True, exist_ok=False)
    process = psutil.Process()
    began_cpu = process.cpu_times()
    started = time.perf_counter()
    deadline = started
    samples = observed_samples = missed_deadlines = 0
    sum_error_squared = sum_absolute_error = sum_step_ns = max_step_ns = 0
    memory_min = memory_max = None
    status = 'running'
    try:
        with (output/'samples.csv').open('x', newline='') as stream, (output/'memory.csv').open('x', newline='') as memory_stream:
            writer, memory_writer = csv.writer(stream), csv.writer(memory_stream)
            writer.writerow(('elapsed_s','target_s','step_ns','observed','error_x','error_y','identity_epoch'))
            memory_writer.writerow(('elapsed_s','rss_bytes','private_bytes','threads'))
            next_memory = 0
            while True:
                now = time.perf_counter()
                elapsed = now - started
                if elapsed >= seconds:
                    break
                # Deliberate 0.8s observation loss every 17s, plus 10% dropout.
                available = not (8 < elapsed % 17 < 8.8) and rng.random() >= .1
                measurement = truth(elapsed) + rng.normal(0, configuration['noise_px'], 2) if available else None
                began = time.perf_counter_ns()
                tracker.update(elapsed, measurement, .8)
                prediction = tracker.predict(horizon)
                duration = time.perf_counter_ns() - began
                sum_step_ns += duration
                max_step_ns = max(max_step_ns, duration)
                samples += 1
                if prediction is not None:
                    error = prediction - truth(elapsed+horizon)
                    if not np.isfinite(error).all():
                        raise ArithmeticError('Nonfinite forecast/error')
                    sum_error_squared += float(error@error)
                    sum_absolute_error += float(np.abs(error).sum())
                    observed_samples += 1
                    writer.writerow((elapsed,elapsed+horizon,duration,int(available),*error,tracker.resets))
                else:
                    writer.writerow((elapsed,elapsed+horizon,duration,int(available),'','',tracker.resets))
                if elapsed >= next_memory:
                    memory = process.memory_info()
                    memory_writer.writerow((elapsed,memory.rss,getattr(memory,'private',None),process.num_threads()))
                    memory_min = memory.rss if memory_min is None else min(memory_min,memory.rss)
                    memory_max = memory.rss if memory_max is None else max(memory_max,memory.rss)
                    stream.flush()
                    memory_stream.flush()
                    next_memory = elapsed+1
                deadline += 1/60
                remaining = deadline-time.perf_counter()
                if remaining > 0:
                    time.sleep(remaining)
                else:
                    missed_deadlines += 1
                    deadline = time.perf_counter()  # No catch-up queue of stale samples.
        status = 'passed'
    finally:
        elapsed = time.perf_counter()-started
        cpu = process.cpu_times()
        summary = dict(status=status,scope='offline synthetic 60Hz tracker only; not GUI/GPU pipeline',requested_s=seconds,actual_s=elapsed,
            is_long_soak=seconds>=5400 and elapsed>=seconds,samples=samples,scored=observed_samples,missed_deadlines=missed_deadlines,
            prediction_enabled=configuration['prediction_enabled'],horizon_s=horizon,resets=tracker.resets,
            coordinate_mae_px=sum_absolute_error/(2*observed_samples) if observed_samples else None,
            coordinate_rmse_px=math.sqrt(sum_error_squared/(2*observed_samples)) if observed_samples else None,
            step_mean_us=sum_step_ns/(1000*samples) if samples else None,step_max_us=max_step_ns/1000,
            rss_min_bytes=memory_min,rss_max_bytes=memory_max,
            cpu_s=cpu.user+cpu.system-began_cpu.user-began_cpu.system)
        (output/'summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False))
    print(json.dumps(summary,allow_nan=False))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--seconds',type=float,default=5400)
    parser.add_argument('--output',type=Path,required=True)
    arguments=parser.parse_args()
    run(arguments.config,arguments.seconds,arguments.output)
