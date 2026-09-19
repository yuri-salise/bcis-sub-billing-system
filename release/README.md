# BCIS Desktop Distribution & Release Packages

This directory houses the compiled Windows desktop distribution binaries and installers for the **Bukidnon Cable and Internet Services (BCIS) Subscription Billing and Collection System**.

## 1. Distribution Artifacts Overview

The desktop workstation application is packaged using `electron-builder` with standard Windows distribution targets:

| Artifact Target | Package Name Format | Target Audience / Use Case |
| :--- | :--- | :--- |
| **NSIS Installer** | `BCIS Subscription Billing & Collection System Setup 1.0.0.exe` | Standard office installation on permanent workstations (Owner PC, Cashier Counter PC, Operations PC) with desktop shortcut and start menu registration. |
| **Portable Executable** | `BCIS-Billing-System-Portable-1.0.0.exe` | Zero-install standalone executable for field laptops, supervisory inspection, or emergency workstation backup. |

## 2. Compilation Instructions

To build the Windows executables from source:

```powershell
# 1. Build all monorepo dependencies and TypeScript packages
pnpm run build

# 2. Build full distribution targets (NSIS + Portable)
pnpm --filter @bcis/desktop run dist

# Alternatively build individual targets:
pnpm --filter @bcis/desktop run dist:portable
pnpm --filter @bcis/desktop run dist:nsis
```

Compiled binaries and unpacked executables will be output to this directory (`release/`).

## 3. Workstation Network Configuration

Upon installation on client workstations:
1. Open **System Settings (`Ctrl + 9`)**.
2. Configure the **Server Host IP** to point to the designated Fastify API server on the office LAN (default: `http://192.168.1.100:3001`).
3. Set the **Workstation Terminal ID** (e.g., `COUNTER-01`, `COUNTER-02`, `ADMIN-01`).
4. Select the configured **80mm ESC/POS Thermal Receipt Printer**.
