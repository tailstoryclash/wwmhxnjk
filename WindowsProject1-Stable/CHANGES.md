# Source-package changes

## Reliability and performance

- Detector initialization failures now leave the loading state, allowing the UI to report failure rather than remain stuck loading.
- TensorRT engine loading uses scoped file ownership, checked 64-bit file sizes, and allocation-failure handling rather than an arbitrary 1 GiB limit.
- Overlay snapshots share immutable detection storage instead of repeatedly copying detection vectors.
- Async tracking deactivates movement after a fresh no-target result; activation generations prevent pending commands from an older activation being dispatched after cancellation. Send-history trimming compacts its existing storage.
- Configuration-storage failures are reported to the user. Opening the data/history folder also handles storage errors.
- The performance panel reuses fonts, cleans up GDI resources, and paints directly when buffered painting is unavailable.

Authentication remains intact. No measured FPS or aiming-accuracy gain is claimed.

## Build and package

- Added prerequisite checks, pinned public inference-dependency restoration, and Windows build instructions.
- Corrected KeyAuth project header references; retained the supplied KeyAuth SDK and libraries.
- Build scripts stage ONNX Runtime/DirectML DLLs and warn about missing optional diagnostics.
- Added portable regression tests and a runner for the existing Windows core tests.

## Verification

Passed in the Linux preparation environment:

- All three portable C++20 regression executables: detection snapshots, detector state, and tracking logic (16 tracking checks).
- Python syntax checks for all 11 supplied tools.
- Help invocation for calibration, log comparison, diagnostics, and offline model checking.
- Visual Studio project/filter XML parsing and local source-file reference checks.

Several optional analysis tools could not run their help command because NumPy or pandas was not installed. These tools may also require ONNX Runtime and other dependencies for actual analysis; they are not required to compile the application.

Not verified: native Windows/MSVC builds, PowerShell/batch execution, GUI appearance and interaction, authentication-service connectivity, GPU inference, capture/HID behavior, model quality, or performance/accuracy measurements. TensorRT builds still require the external NVIDIA SDKs documented in BUILDING.md; model weights and engines are not included.
