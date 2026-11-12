#!/usr/bin/env python3
"""FEATURE-V11-OFFLINE: deterministic local ONNX image/video diagnostic runner.
No game, screen capture, HID, SendInput, network, auth or package installation.
Optional dependencies are checked, NEVER installed automatically:
  ONNX+images: numpy, Pillow, onnxruntime; video additionally needs opencv-python.
This is a tensor/latency diagnostic, NOT an aiming or accuracy benchmark.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import time

def quantile(values, q):
    ordered = sorted(values)
    if not ordered:
        return None
    i = (len(ordered) - 1) * q
    a, b = math.floor(i), math.ceil(i)
    return ordered[a] + (ordered[b] - ordered[a]) * (i - a)

def resolve_side(shape, explicit):
    if len(shape) != 4 or (isinstance(shape[0], int) and shape[0] != 1) or shape[1] != 3:
        raise ValueError("Only batch=1, RGB, NCHW input is supported")
    h, w = shape[2:]
    static = isinstance(h, int) and isinstance(w, int)
    side = h if static else explicit
    if side is None or not 64 <= side <= 640 or (static and h != w):
        raise ValueError("Square input 64..640 required; use --size for dynamic spatial axes")
    if explicit and static and side != explicit:
        raise ValueError("--size conflicts with static ONNX shape")
    for dimension in (h, w):
        if isinstance(dimension, int) and dimension != side:
            raise ValueError("Requested size conflicts with a static spatial dimension")
    return side

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def letterbox(image, side, np, Image):
    image = image.convert("RGB")
    ratio = min(side / image.width, side / image.height)
    w, h = max(1, round(image.width * ratio)), max(1, round(image.height * ratio))
    # FIX-V11.1-PILLOW: Image.Resampling exists only in Pillow >= 9.1.
    bilinear = getattr(getattr(Image, "Resampling", Image), "BILINEAR")
    scaled = image.resize((w, h), bilinear)
    # This is an explicit reproducible offline transform; not a claim of
    # bit-identical D3D shader interpolation or inference numerics.
    canvas = Image.new("RGB", (side, side), (114, 114, 114))
    canvas.paste(scaled, ((side - w) // 2, (side - h) // 2))
    return np.ascontiguousarray(np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0)

def inputs(path, limit, Image):
    if path.suffix.lower() in (".mp4", ".mkv", ".avi", ".mov", ".webm"):
        try:
            import cv2
        except ImportError as e:
            raise ValueError("Video requires optional opencv-python; no dependency was installed") from e
        capture = cv2.VideoCapture(str(path))
        try:
            if not capture.isOpened():
                raise ValueError("Cannot open video")
            for index in range(limit):
                ok, frame = capture.read()
                if not ok:
                    break
                yield index, Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        finally:
            capture.release()
    else:
        names = sorted(p for p in path.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".bmp")) if path.is_dir() else [path]
        for index, item in enumerate(names[:limit]):
            with Image.open(item) as image:
                yield index, image.copy()

def run(args):
    try:
        import numpy as np
        from PIL import Image
        import onnxruntime as ort
    except ImportError as e:
        raise ValueError("Install optional dependencies explicitly: numpy Pillow onnxruntime (video: opencv-python). Nothing was installed automatically") from e
    if args.model.suffix.lower() != ".onnx":
        raise ValueError("Offline runner supports ONNX only; TensorRT engine diagnostics use the application's existing benchmark-engine.cmd")
    if not 1 <= args.limit <= 10000 or not 0 <= args.warmup <= 100:
        raise ValueError("--limit must be 1..10000; --warmup 0..100")
    if args.output.exists():
        raise ValueError("Output already exists; select a new report filename")
    model_hash = sha256(args.model)
    np.random.seed(0)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    start = time.perf_counter()
    session = ort.InferenceSession(str(args.model), sess_options=options, providers=["CPUExecutionProvider"])
    load_ms = (time.perf_counter() - start) * 1000
    metadata = session.get_inputs()
    if len(metadata) != 1 or metadata[0].type != "tensor(float)":
        raise ValueError("Exactly one float32 input is required")
    side = resolve_side(metadata[0].shape, args.size)
    feed_name = metadata[0].name
    rows = []
    for index, image in inputs(args.input, args.limit, Image):
        tensor = letterbox(image, side, np, Image)
        if not rows:
            for _ in range(args.warmup):
                session.run(None, {feed_name: tensor})
        start = time.perf_counter()
        outputs = session.run(None, {feed_name: tensor})
        inference_ms = (time.perf_counter() - start) * 1000
        if not outputs or not all(isinstance(o, np.ndarray) and o.size for o in outputs):
            raise ValueError("Dense, nonempty tensor outputs are required")
        finite = all(bool(np.isfinite(output).all()) for output in outputs)
        rows.append({"frame": index, "inference_ms": inference_ms, "finite": finite,
                     "outputs": [{"shape": list(o.shape), "dtype": str(o.dtype)} for o in outputs]})
        if not finite:
            raise ValueError("Non-finite output at frame " + str(index))
    if not rows:
        raise ValueError("No readable input frames")
    if sha256(args.model) != model_hash:
        raise ValueError("Model file changed during the run; result is not reproducible")
    times = [r["inference_ms"] for r in rows]
    report = {"revision": "ui-v11-reliability-1.0.3", "mode": "offline CPU ONNX diagnostic",
              "model_sha256": model_hash, "runtime": ort.__version__, "input_side": side,
              "load_ms": load_ms, "warmup_runs": args.warmup, "frames": len(rows),
              "inference_ms": {"mean": statistics.mean(times), "p50": quantile(times, .5), "p95": quantile(times, .95), "p99": quantile(times, .99)},
              "observations": rows,
              "limitations": ["Inference timing excludes decoding, preprocessing, disk I/O and display.",
                              "CPU output is not guaranteed bit-identical to WinML/TensorRT/D3D.",
                              "No ground-truth labels: no accuracy or live-game FPS claim."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Refuse accidental overwrites of a prior experiment.
    with args.output.open("x", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return report

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True, help="image, folder of images, or video")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--size", type=int)
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--warmup", type=int, default=3)
    parser.add_argument("--pause", action="store_true",
                        help="wait for Enter before exiting (used when started from the GUI console)")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        # Argument errors must stay readable in the GUI-started console too.
        _pause_if("--pause" in (sys.argv[1:] if argv is None else argv))
        raise
    try:
        report = run(args)
        print(json.dumps({k: report[k] for k in ("mode", "frames", "inference_ms")}, indent=2))
        print("Report: " + str(args.output))
        code = 0
    except Exception as e:
        print("Offline diagnostic failed: " + str(e), file=sys.stderr)
        code = 1
    # FIX-V11.1-CONSOLE: 1.0.0 closed the GUI-started console before the
    # result or error could be read.
    _pause_if(args.pause)
    return code

def _pause_if(enabled):
    if enabled and sys.stdin is not None and sys.stdin.isatty():
        try:
            input("\nНажмите Enter, чтобы закрыть окно... ")
        except (EOFError, KeyboardInterrupt):
            pass

if __name__ == "__main__":
    raise SystemExit(main())
