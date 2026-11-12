# offline_tracking.py
"""Timestamped 2D filters for CSV/synthetic validation; no screen or input APIs.

Units: seconds and pixels. State is per instance and single-thread owned.
Strictly increasing timestamps; gaps > 0.5 s since the last observation reset
identity. Missing measurements propagate Kalman covariance without correction.
Prediction is read-only and is bounded to 0..0.25 s. NumPy >=1.26 is required.
"""
from __future__ import annotations
import math
import numpy as np


class Tracker:
    METHODS = ("ema", "one_euro", "cv", "ca", "kalman")

    def __init__(self, method: str = "kalman", noise_px: float = 6.0,
                 acceleration_px_s2: float = 600.0, max_gap_s: float = 0.5):
        if method not in self.METHODS:
            raise ValueError("Unknown filter")
        if not all(math.isfinite(v) and v > 0 for v in (noise_px, acceleration_px_s2, max_gap_s)):
            raise ValueError("Noise, acceleration and maximum gap must be positive finite numbers")
        self.method, self.noise, self.accel_noise, self.max_gap = method, noise_px, acceleration_px_s2, max_gap_s
        self.time = self.observed_at = None
        self.position = self.velocity = self.acceleration = self.raw = None
        self.raw_velocity = np.zeros(2)
        self.state = None
        self.covariance = None
        self.resets = 0

    def _seed(self, timestamp: float, measurement: np.ndarray) -> None:
        self.position = measurement.copy()
        self.raw = measurement.copy()
        self.velocity = np.zeros(2)
        self.acceleration = np.zeros(2)
        self.raw_velocity = np.zeros(2)
        self.state = np.r_[measurement, 0.0, 0.0]
        self.covariance = np.diag([self.noise ** 2] * 2 + [100000.0] * 2)
        self.observed_at = timestamp
        self.resets += 1

    def update(self, timestamp: float, measurement=None, quality: float = 1.0):
        if not math.isfinite(timestamp) or (self.time is not None and timestamp <= self.time):
            raise ValueError("Timestamp must be finite and strictly increasing")
        if not math.isfinite(quality) or not 0 < quality <= 1:
            raise ValueError("Quality must be in (0, 1]")
        measured = None if measurement is None else np.asarray(measurement, dtype=np.float64)
        if measured is not None and (measured.shape != (2,) or not np.isfinite(measured).all()):
            raise ValueError("Measurement must contain exactly two finite coordinates")
        dt = 0.0 if self.time is None else timestamp - self.time
        expired = self.observed_at is None or timestamp - self.observed_at > self.max_gap
        self.time = timestamp
        if expired:
            self.position = self.state = None
            if measured is None:
                return None
            self._seed(timestamp, measured)
            return self.predict(0)
        if self.method == "kalman":
            transition = np.eye(4)
            transition[0, 2] = transition[1, 3] = dt
            drive = np.array([[dt * dt / 2, 0], [0, dt * dt / 2], [dt, 0], [0, dt]])
            process_noise = drive @ drive.T * self.accel_noise ** 2
            self.state = transition @ self.state
            self.covariance = transition @ self.covariance @ transition.T + process_noise
            if measured is not None:
                variance = np.eye(2) * self.noise ** 2 / quality
                innovation_cov = self.covariance[:2, :2] + variance
                gain = np.linalg.solve(innovation_cov, self.covariance[:2, :]).T
                self.state += gain @ (measured - self.state[:2])
                residual = np.eye(4)
                residual[:, :2] -= gain
                self.covariance = residual @ self.covariance @ residual.T + gain @ variance @ gain.T
                self.covariance = (self.covariance + self.covariance.T) * 0.5
                self.observed_at = timestamp
            self.position, self.velocity = self.state[:2].copy(), self.state[2:].copy()
        elif measured is not None:
            elapsed = timestamp - self.observed_at
            velocity = (measured - self.raw) / elapsed
            if self.method in ("ema", "one_euro"):
                if self.method == "one_euro":
                    derivative_alpha = 1 - math.exp(-2 * math.pi * elapsed)
                    self.raw_velocity += derivative_alpha * (velocity - self.raw_velocity)
                    cutoff = 1.0 + 0.03 * np.linalg.norm(self.raw_velocity)
                else:
                    cutoff = 4.0
                alpha = 1 - math.exp(-2 * math.pi * cutoff * elapsed * quality)
                filtered = self.position + alpha * (measured - self.position)
                self.velocity = (filtered - self.position) / elapsed
                self.position = filtered
            else:
                self.acceleration = (velocity - self.velocity) / elapsed
                self.position, self.velocity = measured.copy(), velocity
            self.raw = measured.copy()
            self.observed_at = timestamp
        return self.predict(0)

    def predict(self, horizon_s: float = 0.05):
        if not math.isfinite(horizon_s) or not 0 <= horizon_s <= 0.25:
            raise ValueError("Prediction horizon must be finite and in [0, 0.25] seconds")
        if self.position is None:
            return None
        elapsed = horizon_s if self.method == "kalman" else horizon_s + self.time - self.observed_at
        prediction = self.position + self.velocity * elapsed
        if self.method == "ca":
            prediction = prediction + 0.5 * self.acceleration * elapsed ** 2
        if not np.isfinite(prediction).all():
            raise ArithmeticError("Nonfinite prediction")
        return prediction.copy()
