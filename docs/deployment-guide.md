# BCIS Subscription Billing and Collection System — Deployment & LAN Setup Guide

## 1. Network Topology & Workstation Configuration

The BCIS office deployment consists of one Central Server workstation and three Client Workstations connected over a private Gigabit Local Area Network (LAN).

```text
                             LOCAL OFFICE LAN (192.168.1.0/24)
                                             │
             ┌───────────────────────────────┼───────────────────────────────┐
             │                               │                               │
             ▼                               ▼                               ▼
       WORKSTATION 1                   WORKSTATION 2                   WORKSTATION 3
     Owner / Admin PC                 Cashier Counter PC               Operations PC
     IP: 192.168.1.101                IP: 192.168.1.102                IP: 192.168.1.103
     OS: Windows 10/11 Pro            OS: Windows 10/11 Pro            OS: Windows 10/11 Pro
     [BCIS Desktop Client]            [BCIS Desktop Client]            [BCIS Desktop Client]
             │                               │                               │
             └───────────────────────────────┼───────────────────────────────┘
                                             │
                                             ▼
                                   CENTRAL SERVER HOST
                                    IP: 192.168.1.100 (Static)
                                    OS: Windows 10/11 Pro or Server
                                    ├── Fastify 5 API Server (Port 4000)
                                    ├── PostgreSQL 17 Database (Port 5432)
                                    ├── Attachments Repository (C:\BCIS\data\attachments)
                                    └── Backups Archive (C:\BCIS\data\backups)
```

---

## 2. Central Server Workstation Installation

### 2.1 Prerequisites
- **Operating System**: Windows 10/11 Pro (64-bit) with static IP assignment (`192.168.1.100`).
- **Runtime**: Node.js v20+ LTS or v22 LTS.
- **Package Manager**: pnpm v9+ / v12+.
- **Database**: PostgreSQL 16+ or 17.

### 2.2 PostgreSQL Configuration
1. Open `C:\Program Files\PostgreSQL\17\data\postgresql.conf`:
   ```text
   listen_addresses = '127.0.0.1, 192.168.1.100'
   port = 5432
   max_connections = 100
   shared_buffers = 512MB
   ```
2. Open `C:\Program Files\PostgreSQL\17\data\pg_hba.conf` and authorize the local host:
   ```text
   # IPv4 local connections:
   host    all             all             127.0.0.1/32            scram-sha-256
   host    bcis_billing_db bcis_user       192.168.1.100/32        scram-sha-256
   ```
3. Restart the PostgreSQL service:
   ```powershell
   Restart-Service -Name postgresql-x64-17
   ```

### 2.3 Windows Firewall Configuration
Allow inbound TCP traffic on port 4000 (Fastify API) exclusively from the office LAN subnet:
```powershell
New-NetFirewallRule -DisplayName "BCIS Fastify API Server (Port 4000)" `
  -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow `
  -RemoteAddress 192.168.1.0/24
```
*(Note: Port 5432 for PostgreSQL must NOT be opened to the client PCs; only the local Fastify API communicates with PostgreSQL).*

### 2.4 Server Environment Setup
Create the production `.env` configuration file in the project directory:
```bash
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=4000
API_CORS_ORIGIN=*

DATABASE_URL=postgres://bcis_user:bcis_password@localhost:5432/bcis_billing_db
DB_POOL_MIN=2
DB_POOL_MAX=20

JWT_SECRET=super-secret-bcis-jwt-token-key-change-in-production-min-32-chars
JWT_EXPIRES_IN=8h

ATTACHMENTS_DIR=C:/BCIS/data/attachments
BACKUPS_DIR=C:/BCIS/data/backups
```

### 2.5 Run Migrations & Start Server
```powershell
# Run database migrations
pnpm run db:migrate

# Seed synthetic initial data (admin user, service plans, areas)
pnpm run db:seed

# Start Fastify server in production mode
pnpm --filter @bcis/api start
```

---

## 3. Client Workstation Deployment

### 3.1 Client Installation
1. Compile the Windows desktop installer on the build workstation:
   ```powershell
   pnpm run build:desktop
   ```
   This generates the installer: `release/BCIS-Setup-1.0.0.exe`.
2. Run `BCIS-Setup-1.0.0.exe` on each office workstation:
   - **PC 1 (Owner / Admin)**
   - **PC 2 (Cashier Counter)**
   - **PC 3 (Operations / Field Coordinator)**

### 3.2 Client Configuration
Each client workstation points to the Central Server's LAN IP address:
In the desktop application configuration or `VITE_API_BASE_URL`:
```text
http://192.168.1.100:4000/api/v1
```
The desktop client verifies the network connection on startup via `GET http://192.168.1.100:4000/health`. If the server is unreachable, a clear diagnostic dialog displays the configured IP address and troubleshooting steps.

---

## 4. Automated Backup & Maintenance Runbook

### 4.1 Scheduled Daily Backups
Configure a Windows Scheduled Task on the Central Server running at 23:00 daily:
```powershell
$Date = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = "C:\BCIS\data\backups\bcis_backup_$Date.dump"
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U bcis_user -h localhost -p 5432 -F c -b -v -f $BackupFile bcis_billing_db
```

### 4.2 Disaster Recovery & Database Restoration Protocol
To restore from a backup:
1. Notify all client workstations to close the BCIS Desktop application.
2. Terminate existing database connections:
   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'bcis_billing_db' AND pid <> pg_backend_pid();
   ```
3. Run `pg_restore`:
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -U bcis_user -h localhost -p 5432 -d bcis_billing_db --clean --if-exists "C:\BCIS\data\backups\bcis_backup_TARGET.dump"
   ```
4. Perform post-restoration integrity checks by verifying table record counts and launching the health probe.
