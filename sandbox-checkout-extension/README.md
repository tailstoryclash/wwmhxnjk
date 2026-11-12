# Checkout Sandbox — Local Simulator

A standalone Chrome/Edge Manifest V3 extension for demonstrating payment-flow UI states. It never submits payments or contacts a provider. Outcomes are predetermined by the selected scenario, not inferred from card data.

## Install

1. Extract this ZIP to a folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Pin **Checkout Sandbox — Local Simulator** and click its toolbar icon.
5. Select a scenario and press **Run local simulation**. For the verification scenario, choose **Complete verification** or **Cancel**. Use **Reset** to repeat.

Closing the popup clears all state. To uninstall, choose **Remove** on the browser's extensions page.

## Scope

- Fixed reference fixtures from Stripe's official testing documentation: https://docs.stripe.com/testing
- Approval, generic decline, mock verification completion, and cancellation.
- No card entry or generation, BIN imports, checkout injection, network calls, credentials, storage, or host permissions.
- CSP denies connections, form submissions, and embedded frames.
- A mock challenge is not a real 3D Secure integration. No actual processor or bank behavior is verified.
- Do not enter these fixture numbers into production payment forms. Official test cards belong in the provider's sandbox/test mode only.

The supplied third-party extension archive is not used. This package has no dependencies and does not alter the existing Windows project.

## Tests

With Node.js 18 or newer:

```
node --test tests/model.test.cjs
```

For a basic UI preview, `popup.html` can also be opened directly as a local file. That preview does not verify browser-extension installation.
