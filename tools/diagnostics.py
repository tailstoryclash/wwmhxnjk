#!/usr/bin/env python3
"""FEATURE-V11-TOOLS: local-only doctor, reviewable/redacted support packages.

Never reads license.dpapi, config bodies, models, frames, dumps or browser data.
No uploads, network calls, package installation or authentication bypass.
Python 3.10+ standard library only. See PATCH-NOTES-RU.md for scope/limits.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import struct
import subprocess
import sys
import tempfile
import zipfile

VERSION = "ui-v11-reliability-1.0.3"
MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 8 * 1024 * 1024
ALLOWED = ("albion-dev-events.log", "performance_measurements.txt", "winml_errors.txt", "environment-report.json")
# FIX-V11.1-REDACT: the case-insensitive license pattern also matched the
# application's own names ("albion-ui-centered.exe", "albion-dev-events.log"),
# turning useful diagnostics into "[REDACTED-LICENSE].exe". Known product
# tokens are excluded; everything else that looks like a key is still redacted.
NON_SECRET_TOKENS = r"(?:ui-centered|dev-events|v1\d-(?:configs|from-v\d+|reliability))(?![A-Za-z0-9])"
SECRET = re.compile(r"(?i)(?:KEYAUTH-)?ALBION-(?!" + NON_SECRET_TOKENS + r")[A-Za-z0-9-]+")
SENSITIVE_LINE = re.compile(r"(?i)\b(?:license(?:_key)?|password|(?:client[_ -]?)?secret|api[_ -]?key|authorization|access[_ -]?token|refresh[_ -]?token)\b\s*[:=]")

def redact(text: str) -> str:
    text = SECRET.sub("[REDACTED-LICENSE]", text)
    lines = []
    for line in text.splitlines():
        lines.append("[REDACTED-SENSITIVE-LINE]" if SENSITIVE_LINE.search(line) else line)
    text = "\n".join(lines) + "\n"
    home = str(Path.home())
    for value in sorted({home, home.replace("\\", "/"), home.replace("\\", "\\\\"), os.environ.get("USERPROFILE", "")}, key=len, reverse=True):
        if value:
            text = re.sub(re.escape(value), "%USERPROFILE%", text, flags=re.I)
    # Redact other account-profile paths, not just the current process' account.
    return re.sub(r"(?i)(?:[A-Z]:(?:\\{1,2}|/)Users(?:\\{1,2}|/))[^\\/\s\"']+", "%USERPROFILE%", text)

def pe_machine(path: Path) -> str:
    try:
        with path.open("rb") as f:
            header = f.read(64)
            if len(header) != 64 or header[:2] != b"MZ":
                return "not-PE"
            offset = struct.unpack_from("<I", header, 60)[0]
            if offset > 16 * 1024 * 1024:
                return "invalid-PE"
            f.seek(offset)
            signature = f.read(6)
            if signature[:4] != b"PE\0\0" or len(signature) != 6:
                return "invalid-PE"
            return {0x8664: "x64", 0x14C: "x86", 0xAA64: "arm64"}.get(struct.unpack_from("<H", signature, 4)[0], "unknown")
    except OSError as e:
        return "unreadable:" + type(e).__name__

def file_version(path: Path) -> str | None:
    """Read version resources only; never LoadLibrary the inspected DLL."""
    if os.name != "nt":
        return None
    try:
        import ctypes as c
        from ctypes import wintypes as w
        version = c.WinDLL("version.dll", use_last_error=True)
        version.GetFileVersionInfoSizeW.argtypes = [w.LPCWSTR, c.POINTER(w.DWORD)]
        version.GetFileVersionInfoSizeW.restype = w.DWORD
        version.GetFileVersionInfoW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p]
        version.GetFileVersionInfoW.restype = w.BOOL
        version.VerQueryValueW.argtypes = [c.c_void_p, w.LPCWSTR, c.POINTER(c.c_void_p), c.POINTER(w.UINT)]
        version.VerQueryValueW.restype = w.BOOL
        ignored = w.DWORD()
        size = version.GetFileVersionInfoSizeW(str(path), c.byref(ignored))
        if not size or size > 16 * 1024 * 1024:
            return None
        buf = c.create_string_buffer(size)
        if not version.GetFileVersionInfoW(str(path), 0, size, buf):
            return None
        ptr, length = c.c_void_p(), w.UINT()
        if not version.VerQueryValueW(buf, "\\", c.byref(ptr), c.byref(length)) or length.value < 52:
            return None
        info = c.cast(ptr, c.POINTER(w.DWORD))
        if info[0] != 0xFEEF04BD:
            return None
        return ".".join(str(v) for v in (info[2] >> 16, info[2] & 65535, info[3] >> 16, info[3] & 65535))
    except (OSError, ValueError, AttributeError):
        return None

def sanitize_json(value):
    # Redact string values BEFORE JSON escaping so C:\\Users paths cannot
    # leak through doubled backslashes or break the JSON document structure.
    if isinstance(value, str):
        return redact(value).rstrip("\n")
    if isinstance(value, list):
        return [sanitize_json(v) for v in value]
    if isinstance(value, dict):
        return {k: sanitize_json(v) for k, v in value.items()}
    return value

def inventory_dll(name: str, app: Path) -> dict:
    # The patched loader uses app/system/default safe DLL directories, not CWD.
    candidates = [app / name, Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / name]
    result = []
    for p in candidates:
        if p.is_file() and not p.is_symlink():
            result.append({"path": str(p), "bytes": p.stat().st_size, "machine": pe_machine(p), "file_version": file_version(p)})
    return {"name": name, "safe_search_candidates": result, "available": bool(result)}

def can_write(folder: Path) -> bool:
    try:
        folder.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=folder):
            return True
    except OSError:
        return False

def environment_report(app: Path, data: Path) -> dict:
    report = {"revision": VERSION, "time_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
              "platform": platform.platform(), "python": platform.python_version(),
              "app_dir": str(app), "data_dir": str(data), "data_writable": can_write(data),
              "capture_monitor": os.environ.get("ALBION_CAPTURE_MONITOR", "Windows primary monitor"),
              "nvml_gpu_uuid": os.environ.get("ALBION_NVML_GPU_UUID", "not selected; NVML metrics are N/A"),
              "runtimes": [inventory_dll(n, app) for n in ("nvinfer_10.dll", "cudart64_110.dll")],
              "limitations": ["File presence/bitness is not proof of ABI compatibility or successful GPU inference.",
                              "No license cache/config contents, model data, frame capture or input commands are read."]}
    for name in ("albion-ui-centered.exe", "WindowsProject1.exe"):
        exe = app / name
        if exe.is_file():
            report["executable"] = {"name": name, "bytes": exe.stat().st_size, "machine": pe_machine(exe), "file_version": file_version(exe)}
            break
    if os.name == "nt":
        ps = "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress"
        try:
            result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
                                    capture_output=True, text=True, timeout=15, check=False)
            report["display_adapters"] = json.loads(result.stdout) if result.returncode == 0 else "query failed"
        except (OSError, subprocess.TimeoutExpired, ValueError):
            report["display_adapters"] = "query unavailable"
    return report

def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".tmp.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def doctor(app: Path, data: Path) -> Path:
    out = data / "environment-report.json"
    # Store a redacted report too; raw paths are unnecessary in a support bundle.
    atomic_text(out, json.dumps(sanitize_json(environment_report(app, data)), ensure_ascii=False, indent=2) + "\n")
    return out

def safe_tail(path: Path) -> str:
    # Whitelisted text only, bounded read even when a log is unexpectedly huge.
    with path.open("rb") as f:
        size = f.seek(0, 2)
        f.seek(max(0, size - MAX_FILE))
        data = f.read(MAX_FILE)
    if size > MAX_FILE:
        # Discard the initial partial record rather than retaining half a secret.
        data = data.split(b"\n", 1)[1] if b"\n" in data else b""
    return redact(data.decode("utf-8", errors="replace"))

def prepare_support(app: Path, data: Path) -> Path:
    doctor(app, data)
    preview = Path(tempfile.mkdtemp(prefix="support-preview-", dir=data))
    total = 0
    files = {}
    for base in ALLOWED:
        for suffix in (("", ".1", ".2") if base.endswith((".log", ".txt")) else ("",)):
            name = base + suffix
            source = data / name
            if not source.is_file() or source.is_symlink():
                continue
            text = safe_tail(source)
            encoded = text.encode("utf-8")
            if len(encoded) > MAX_FILE * 2 or total + len(encoded) > MAX_TOTAL:
                continue
            atomic_text(preview / name, text)
            files[name] = hashlib.sha256((preview / name).read_bytes()).hexdigest()
            total += len(encoded)
    instructions = ("REVIEW BEFORE SHARING\nNo upload is performed. Read every file and remove anything sensitive.\n"
                    "License/secret patterns and user-profile paths were redacted as a best effort, not a guarantee.\n"
                    "Do not add credentials, license.dpapi, configs, models, screenshots, dumps or other private files.\n"
                    "After review: python diagnostics.py support-finalize --preview <this-folder> --confirm-reviewed\n")
    atomic_text(preview / "REVIEW-FIRST.txt", instructions)
    atomic_text(preview / "manifest.json", json.dumps({"version": 1, "files": files}, indent=2))
    return preview

def finalize_support(preview: Path, confirmed: bool) -> Path:
    if not confirmed:
        raise ValueError("Read/review the preview first; --confirm-reviewed is required")
    if preview.is_symlink() or not preview.is_dir():
        raise ValueError("Preview must be a real directory")
    manifest_path = preview / "manifest.json"
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 65536:
        raise ValueError("Invalid preview manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))  # Notepad BOM tolerated
    files = manifest.get("files", {})
    allowed = {n + suffix for n in ALLOWED for suffix in ("", ".1", ".2")}
    if manifest.get("version") != 1 or not isinstance(files, dict) or set(files) - allowed:
        raise ValueError("Unexpected files in preview manifest")
    archive = preview.with_name(preview.name + ".zip")
    # Read/re-redact only whitelisted text. Edited preview text is allowed; added
    # files (including a cache file) are NEVER swept into the archive recursively.
    output = {}
    for name in files:
        path = preview / name
        if not path.exists():
            continue  # user may remove private files during review
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_FILE * 2:
            raise ValueError("Invalid preview file: " + name)
        # utf-8-sig: Notepad may add a BOM while the user reviews/edits a file.
        output[name] = redact(path.read_text(encoding="utf-8-sig")).encode("utf-8")
    if sum(map(len, output.values())) > MAX_TOTAL:
        raise ValueError("Preview exceeds size limit")
    # Exclusive archive creation avoids overwriting a previous reviewed bundle.
    created = False
    try:
        with archive.open("xb") as stream:
            created = True
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as z:
                for name, body in output.items():
                    z.writestr(name, body)
                z.writestr("README.txt", "User-reviewed, local-only diagnostic bundle. No automatic upload.\n")
    except Exception:
        if created:
            archive.unlink(missing_ok=True)  # only this attempt's partial file
        raise
    return archive

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("doctor", "support-prepare", "support-finalize"))
    parser.add_argument("--app-dir", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("LOCALAPPDATA", Path.home())) / "AlbionAI")
    parser.add_argument("--preview", type=Path)
    parser.add_argument("--confirm-reviewed", action="store_true")
    parser.add_argument("--open-folder", action="store_true")
    parser.add_argument("--pause", action="store_true",
                        help="wait for Enter before exiting (used when started from the GUI console)")
    try:
        args = parser.parse_args(argv)
    except SystemExit:
        # Argument errors must stay readable in the GUI-started console too.
        pause_if_requested("--pause" in (sys.argv[1:] if argv is None else argv))
        raise
    code = run_command(parser, args)
    pause_if_requested(args.pause)
    return code

def pause_if_requested(enabled: bool) -> None:
    # FIX-V11.1-CONSOLE: the GUI opens a new console; keep results readable.
    if enabled and sys.stdin is not None and sys.stdin.isatty():
        try:
            input("\nНажмите Enter, чтобы закрыть окно... ")
        except (EOFError, KeyboardInterrupt):
            pass

def run_command(parser, args) -> int:
    try:
        if args.command == "doctor":
            out = doctor(args.app_dir.resolve(), args.data_dir.resolve())
        elif args.command == "support-prepare":
            out = prepare_support(args.app_dir.resolve(), args.data_dir.resolve())
        else:
            if not args.preview:
                parser.error("--preview is required")
            out = finalize_support(args.preview.absolute(), args.confirm_reviewed)
        print(out)
        if args.open_folder and os.name == "nt":
            os.startfile(out if out.is_dir() else out.parent)
        return 0
    except (OSError, ValueError, RuntimeError) as e:
        print("Diagnostic tool error: " + str(e), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
