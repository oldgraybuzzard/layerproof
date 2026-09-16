# Trusted Windows releases

Signing is prepared but is **not activated**. No signing certificate or service credentials were present when this workflow was added. The ordinary Windows build remains unsigned. Company metadata and the icon do not constitute a digital signature.

Use an existing authorized signing identity. Do not commit private keys or paste credentials into chat. A certificate/service must establish the publisher's real identity; do not substitute a self-signed certificate for a public trusted release.

## GitHub setup

Create an environment named `windows-signing` in the LayerProof repository, restrict it to `main` and authorized reviewers, and configure its secrets and variables below. Repository visibility does not expose GitHub environment secrets, but environment approvals and least-privilege access are still required. Set `SIGNING_PUBLISHER` to the exact certificate publisher name. Use the verified identity for Melken TechWork, not an invented subject name.

For **Azure signing**, configure variables `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, and `SIGNING_PUBLISHER`. Configure secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` for an authorized identity with signing access to that profile. Provisioning, identity validation, subscription charges, and service permissions must be arranged by the account owner before running the build.

For an existing **exportable certificate**, configure secrets `WIN_CSC_LINK` (the PFX/P12 encoded in base64) and `WIN_CSC_KEY_PASSWORD`, plus variable `SIGNING_PUBLISHER`. This route only applies if your certificate provider permits that private-key storage. Hardware-token/non-exportable certificates require their provider integration; do not export their keys to fit this workflow.

Run **Build signed Windows installer** manually on main, choosing the configured provider. The build fails if required settings are absent, signing fails, the publisher differs, or the installer/app/uninstaller lacks a valid timestamped Authenticode signature. Only a passing run uploads the signed installer artifact. This workflow does not publish a public release.

The separate **Build release candidates** workflow produces unsigned Windows and macOS artifacts. Manual runs upload Actions artifacts only. A matching `v*` tag creates a draft GitHub Release, which must not be published until the EULA is legally approved and the required platform signing and notarization checks are complete.

Local Windows builds use `npm run dist:win:signed` with the same variable names, except `SIGNING_PUBLISHER` becomes `LAYERPROOF_SIGNING_PUBLISHER` and `LAYERPROOF_SIGNING_PROVIDER` selects `azure` or `certificate`. Keep credentials in the process environment or your approved secret manager.

## References

The configuration follows [electron-builder v26 Windows signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/) and the installed v26 signing implementation. See [Electron's signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing) for publisher identity prerequisites. A digital signature establishes publisher identity and integrity; distribution reputation remains separate.
