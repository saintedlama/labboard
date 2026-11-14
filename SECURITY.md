# Security Policy

## Supported Versions

LabBoard is actively maintained. Security patches and bug fixes are provided for the `main` branch and latest published container image.

| Version | Supported |
| --- | --- |
| `main` / `latest` | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in LabBoard, please report it privately.

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

### How to Report

Send an email directly to [christoph.walcher@gmail.com](mailto:christoph.walcher@gmail.com) with the subject line `[SECURITY] LabBoard Vulnerability Report`, or open a private **GitHub Security Advisory** on this repository.

Please include as much detail as possible:

- Type of vulnerability (e.g., XSS, SVG sanitization issue, path traversal, SQL injection, DoS)
- Steps to reproduce the issue (including sample payloads, board JSON, or curl commands)
- Affected version or commit hash
- Potential impact and any suggested mitigation

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Impact evaluated within 5 business days
- **Resolution & Disclosure**: Fixes will be developed privately and disclosed after a patched version is available

## Deployment Security Considerations

When deploying LabBoard, keep the following design choices in mind:

- **No Built-in Authentication**: LabBoard intentionally omits authentication and multi-user access control. By default, the binary binds to `127.0.0.1:8080`. When running with `HOST=0.0.0.0` (including inside Docker), place LabBoard behind a trusted VPN (e.g., Tailscale/WireGuard) or reverse proxy authentication layer.
- **SQLite Storage**: All boards, embedded images, and library items are persisted unencrypted inside the configured SQLite database file (`labboard.db`). Restrict filesystem permissions on the data directory accordingly.
