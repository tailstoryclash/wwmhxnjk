# Albion Windows source package

This package keeps the application, original authentication SDK, ONNX Runtime/DirectML dependencies, and diagnostic tools together:

- `WindowsProject1-Stable/` — application source, build scripts, and regression tests.
- `vendor/` — supplied KeyAuth source and libraries, ONNX Runtime DirectML 1.24.4, and DirectML 1.15.4. Third-party licenses remain in their original directories.
- `tools/` — supplied local diagnostic, calibration, and analysis tools.

## Build on Windows

Keep these three directories side by side. Open an **x64 Native Tools Command Prompt for Visual Studio** with the C++ desktop workload and Windows SDK installed. See `WindowsProject1-Stable/BUILDING.md` for the supported toolset and SDK configuration.

For the ONNX Runtime / DirectML path, without NVIDIA SDK prerequisites:

```bat
cd WindowsProject1-Stable
build.bat false winml
```

The historical `winml` script argument disables TensorRT; the bundled ONNX Runtime backend remains enabled. For TensorRT, install the matching NVIDIA SDKs described in `BUILDING.md` and run `build.bat false trt`.

Model weights and TensorRT engines are not included. Supply a compatible model in the application's `models` folder. Authentication is unchanged and still requires a valid license and its normal online service.

## Regression checks

From the package root, using Python 3.10+ and a C++20 compiler:

```text
python WindowsProject1-Stable/tests/run-portable-tests.py
```

From an x64 Native Tools Command Prompt, also run:

```bat
WindowsProject1-Stable\tests\run-windows-tests.cmd
```

The portable checks do not exercise Windows capture, GPU inference, authentication, or physical input. The Windows checks do not replace a full application build and hardware validation.

## Verification limits

The changes were prepared in a Linux environment. Native Windows compilation, GUI behavior, CUDA/DirectML execution, HID timing, and model-specific aiming accuracy require Windows verification. No measured FPS or accuracy improvement is claimed. See `WindowsProject1-Stable/CHANGES.md` for the changes and verification results.
