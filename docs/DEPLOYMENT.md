# Scalping V2 — Deployment Guide

Production deployment guide for the Scalping V2 Trading System. Compare options, then follow the step-by-step for your target environment.

> **Prerequisites:** complete `README.md` Quick Start first. This guide assumes you have a working local install.

---

## Deployment Options Comparison

| Option | MT5 Support | Best For | Complexity | Recommended |
|--------|-------------|----------|------------|-------------|
| **Windows Service (NSSM)** | Native (MT5 desktop on Windows) | Solo trader Windows desktop | Low | ✅ For most users |
| **Linux VPS (systemd)** | Requires MT5 bridge / Wine | Cloud / always-on | Medium | For remote ops |
| **Docker Compose** | Bridge required | Multi-service isolated | Medium-High | For teams |

**Recommendation:**
- Bila MT5 harus jalan native (Finex Indonesia broker) → **Windows Service**
- Bila ingin remote access dari mana saja → **Linux VPS + MT5 bridge** (Wine or VPS broker)
- Bila ingin full reproducible environment → **Docker Compose**

---

## Option A — Windows Service via NSSM (Recommended)

### Prerequisites

- Windows 11 (Windows 10 22H2+ juga OK)
- NSSM installed: `choco install nssm` atau download dari https://nssm.cc/
- Python 3.14 (atau 3.11+) terinstall di `C:\Python314\`
- Node.js 20+ dan Bun terinstall
- MT5 terminal terinstall + logged in + Algo Trading enabled

### Step 1: Build Frontend (Production)

```powershell
cd C:\scalping_v2
# Set production backend URL
$env:NEXT_PUBLIC_PYTHON_API_URL = "http://localhost:8000"
bun run build
# Output: .next/standalone/ + .next/static/ + public/
```

### Step 2: Install Python Backend as Service

```powershell
# 1. Setup venv sekali
cd C:\scalping_v2\download\python-backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# 2. Install service
nssm install ScalpingV2Backend "C:\scalping_v2\download\python-backend\venv\Scripts\python.exe" "C:\scalping_v2\download\python-backend\main.py"

# 3. Configure
nssm set ScalpingV2Backend AppDirectory "C:\scalping_v2\download\python-backend"
nssm set ScalpingV2Backend AppEnvironmentExtra "PYTHONUNBUFFERED=1" "PYTHONDONTWRITEBYTECODE=1"
nssm set ScalpingV2Backend Start SERVICE_AUTO_START
nssm set ScalpingV2Backend Description "Scalping V2 Python FastAPI backend (MT5 + Ollama + Tiingo)"
nssm set ScalpingV2Backend AppStdout "C:\scalping_v2\logs\backend-stdout.log"
nssm set ScalpingV2Backend AppStderr "C:\scalping_v2\logs\backend-stderr.log"
nssm set ScalpingV2Backend AppStdoutCreationDisposition 4  # append
nssm set ScalpingV2Backend AppStderrCreationDisposition 4
nssm set ScalpingV2Backend AppRotateFiles 1
nssm set ScalpingV2Backend AppRotateBytes 10485760  # 10 MB rotation

# 4. Start
nssm start ScalpingV2Backend
```

### Step 3: Install Next.js Frontend as Service

```powershell
nssm install ScalpingV2Frontend "C:\Program Files\nodejs\node.exe" "C:\scalping_v2\.next\standalone\server.js"
nssm set ScalpingV2Frontend AppDirectory "C:\scalping_v2"
nssm set ScalpingV2Frontend AppEnvironmentExtra "NODE_ENV=production" "PORT=3000" "HOSTNAME=0.0.0.0"
nssm set ScalpingV2Frontend Start SERVICE_AUTO_START
nssm set ScalpingV2Frontend Description "Scalping V2 Next.js dashboard frontend"
nssm set ScalpingV2Frontend AppStdout "C:\scalping_v2\logs\frontend-stdout.log"
nssm set ScalpingV2Frontend AppStderr "C:\scalping_v2\logs\frontend-stderr.log"
nssm set ScalpingV2Frontend AppRotateFiles 1
nssm set ScalpingV2Frontend AppRotateBytes 10485760

nssm start ScalpingV2Frontend
```

### Step 4: Verify

```powershell
# Check service status
sc query ScalpingV2Backend
sc query ScalpingV2Frontend

# Test endpoints
curl http://localhost:8000/healthz
curl http://localhost:3000/

# Tail logs
Get-Content C:\scalping_v2\logs\backend-stdout.log -Wait -Tail 50
```

### Step 5: Auto-start on Boot

Both services are configured `SERVICE_AUTO_START` (start on Windows boot). To verify:

```powershell
sc qc ScalpingV2Backend | findstr START_TYPE
# Should show: AUTO_START
```

### Uninstall

```powershell
nssm stop ScalpingV2Backend
nssm remove ScalpingV2Backend confirm
nssm stop ScalpingV2Frontend
nssm remove ScalpingV2Frontend confirm
```

Or use `download/python-backend/deploy/windows/uninstall-service.bat`.

---

## Option B — Linux VPS (Ubuntu 22.04)

### Prerequisites

- Ubuntu 22.04 VPS (4 GB RAM minimum, 8 GB recommended)
- SSH key access + sudo user
- Domain name pointing to VPS IP (for TLS)
- MT5 bridge: Wine + MT5 desktop OR cloud broker with REST API

### Step 1: System Prep

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install base packages
sudo apt install -y curl wget git build-essential ufw fail2ban unattended-upgrades

# Enable auto security updates
sudo dpkg-reconfigure -plow unattended-upgrades

# Create app user
sudo useradd -m -s /bin/bash scalping
sudo usermod -aG sudo scalping
```

### Step 2: Install Bun + Node.js

```bash
# As scalping user
su - scalping

# Install Bun
curl -fsSL https://bun.sh/install | bash
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Step 3: Install Python + Backend

```bash
# Install Python 3.12 (3.14 if available)
sudo apt install -y python3 python3-venv python3-pip

# Clone repo
cd /opt
sudo git clone https://github.com/teekar2312/scalping_v2.git
sudo chown -R scalping:scalping scalping_v2
cd scalping_v2

# Setup Python venv
cd download/python-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Setup .env
cp .env.example .env
nano .env  # edit MT5_LOGIN, MT5_PASSWORD, etc.
```

### Step 4: Build Frontend

```bash
cd /opt/scalping_v2
# Set backend URL (bila backend di same host)
export NEXT_PUBLIC_PYTHON_API_URL="http://localhost:8000"
bun install
bun run build
```

### Step 5: Systemd Service

```bash
# Copy provided unit (atau buat baru)
sudo cp /opt/scalping_v2/download/python-backend/deploy/systemd/scalping-v2.service /etc/systemd/system/

# Edit paths bila perlu
sudo nano /etc/systemd/system/scalping-v2.service

# Enable + start
sudo systemctl daemon-reload
sudo systemctl enable scalping-v2
sudo systemctl start scalping-v2

# Verify
sudo systemctl status scalping-v2
sudo journalctl -u scalping-v2 -f --no-pager
```

Frontend service (`scalping-v2-frontend.service`):

```ini
[Unit]
Description=Scalping V2 Next.js Frontend
After=network.target scalping-v2.service

[Service]
Type=simple
User=scalping
WorkingDirectory=/opt/scalping_v2
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/bin/node /opt/scalping_v2/.next/standalone/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo nano /etc/systemd/system/scalping-v2-frontend.service
# paste di atas, lalu:
sudo systemctl daemon-reload
sudo systemctl enable scalping-v2-frontend
sudo systemctl start scalping-v2-frontend
```

### Step 6: Nginx Reverse Proxy

```bash
sudo apt install -y nginx

sudo tee /etc/nginx/sites-available/scalping-v2 <<'EOF'
server {
    listen 80;
    server_name scalping.your-domain.com;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Health & metrics
    location ~ ^/(healthz|readyz|metrics)$ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/scalping-v2 /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### Step 7: SSL/TLS dengan Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d scalping.your-domain.com \
  --non-interactive --agree-tos --email your-email@example.com \
  --redirect

# Auto-renewal sudah ter-set (certbot.timer)
sudo systemctl status certbot.timer
```

### Step 8: Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp         # SSH
sudo ufw allow 80/tcp         # HTTP (Let's Encrypt challenge + redirect)
sudo ufw allow 443/tcp        # HTTPS
sudo ufw enable

# Verify
sudo ufw status verbose
```

### Step 9: fail2ban (SSH brute-force protection)

```bash
sudo tee /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
EOF

sudo systemctl enable fail2ban
sudo systemctl start fail2ban
sudo fail2ban-client status sshd
```

### Step 10: MT5 Bridge (bila perlu)

For Linux, MT5 desktop tidak tersedia native. Options:

**Option 1: Wine + MT5 (recommended)**
```bash
sudo dpkg --add-architecture i386
sudo apt install -y wine wine32 wine64
# Install MT5 via Wine: download .exe, run `wine mt5setup.exe`
```

**Option 2: VPS broker dengan REST API** — beberapa broker (OANDA, IG) menawarkan REST trading API. Modify `mt5_connector.py` untuk pakai API tersebut.

**Option 3: Hybrid** — Windows desktop untuk MT5, Linux VPS untuk frontend/backend (yang connect ke Windows MT5 via HTTP).

---

## Option C — Docker Compose

### docker-compose.yml (root repo)

Sudah disediakan di repo root. Modify environment variables di `.env`:

```env
# .env (root)
MT5_LOGIN=50384721
MT5_PASSWORD=your_password
MT5_SERVER=FinexIC-Markets
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=llama3.2:latest
TIINGO_API_KEY=your_key
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
DATABASE_URL=file:/data/scalping-v2.db
SECRET_KEY=your_32_byte_secret
NEXT_PUBLIC_PYTHON_API_URL=http://localhost:8000
```

### Run

```bash
# Build + start
docker compose up -d

# Verify
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend

# Stop
docker compose down

# Update
git pull
docker compose build
docker compose up -d
```

### Volumes

- `backend-data` → `/data` (SQLite + backups)
- `ollama-models` → `/root/.ollama` (cached models, no re-download)

---

## Backup Strategy

### Automated (Backend cron)

Tambahkan ke backend Python (atau cron job Linux):

```bash
# Cron — daily 2 AM backup
0 2 * * * /opt/scalping_v2/download/python-backend/venv/bin/python -c "
import asyncio
from database import backup_database
asyncio.run(backup_database(offsite=True))
" >> /var/log/scalping-backup.log 2>&1
```

### Manual (UI)

1. Settings → Database Backup → Download .sqlite
2. Atau System Health → "Upload Now" untuk offsite backup ke S3

### Offsite (S3)

Setup AWS CLI + configure:

```bash
sudo apt install -y awscli
sudo -u scalping aws configure  # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, region
```

Set `.env`: `S3_BACKUP_BUCKET=scalping-v2-backups`

Backups encrypted bila `ENCRYPTION_KEY` di-set (SQLCipher).

---

## Monitoring Setup (Prometheus + Grafana)

### Prometheus

Tambahkan ke `docker-compose.yml` (atau install standalone):

```yaml
prometheus:
  image: prom/prometheus:latest
  ports:
    - "9090:9090"
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--storage.tsdb.retention.time=30d'
```

`prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'scalping-v2-backend'
    metrics_path: /metrics
    static_configs:
      - targets: ['backend:8000']
```

### Grafana

```yaml
grafana:
  image: grafana/grafana:latest
  ports:
    - "3001:3000"
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
  volumes:
    - grafana-data:/var/lib/grafana
```

Add Prometheus as datasource (`http://prometheus:9090`). Import dashboard ID 1860 (Node Exporter) + custom Scalping V2 dashboard.

### Alert Rules (Prometheus)

```yaml
groups:
  - name: scalping-v2
    rules:
      - alert: ScalpingV2BotDown
        expr: scalping_v2_bot_uptime_seconds < 60
        for: 5m
        annotations:
          summary: "Scalping V2 bot down"
      - alert: ScalpingV2HighErrorRate
        expr: rate(scalping_v2_http_errors_total[5m]) > 0.1
        for: 10m
        annotations:
          summary: "High error rate"
      - alert: ScalpingV2DiskFull
        expr: 100 - (node_filesystem_avail_bytes{mountpoint="/"} * 100 / node_filesystem_size_bytes{mountpoint="/"}) > 85
        for: 5m
        annotations:
          summary: "Disk usage > 85%"
```

---

## Update / Upgrade Procedure

### Frontend Update

```bash
cd /opt/scalping_v2
git pull origin main
bun install  # bila package.json berubah
bun run build

# Restart service
sudo systemctl restart scalping-v2-frontend
# atau Windows: nssm restart ScalpingV2Frontend
```

### Backend Update

```bash
cd /opt/scalping_v2/download/python-backend
git pull origin main
source venv/bin/activate
pip install -r requirements.txt --upgrade

# Restart
sudo systemctl restart scalping-v2
# atau Windows: nssm restart ScalpingV2Backend
```

### Database Migration (Prisma)

```bash
cd /opt/scalping_v2
bun run db:migrate    # apply new migrations
# atau: bun run db:push  (struktur saja, no migration files)
```

### Rollback

```bash
# Find previous good commit
git log --oneline -20
git checkout <previous-commit-hash>
bun run build
sudo systemctl restart scalping-v2-frontend

# Database rollback (bila perlu)
bun run db:migrate --rollback
```

---

## Health Verification (Post-Deploy)

```bash
# 1. Service status
sudo systemctl status scalping-v2 scalping-v2-frontend
# Windows: sc query ScalpingV2Backend; sc query ScalpingV2Frontend

# 2. Endpoints
curl -s https://scalping.your-domain.com/api/healthz | jq
curl -s https://scalping.your-domain.com/api/readyz | jq

# 3. Prometheus metrics
curl -s https://scalping.your-domain.com/metrics | head -30

# 4. Frontend loads
curl -sI https://scalping.your-domain.com/ | head -5

# 5. WebSocket (manual test)
# Open browser → DevTools → Console:
# const ws = new WebSocket('wss://scalping.your-domain.com/ws');
# ws.onopen = () => console.log('connected');
```

Expected: all `healthy`, frontend returns 200 OK, WS connects within 2s.

---

## Troubleshooting Deployment

**Service won't start**
- Check logs: `journalctl -u scalping-v2 -n 100` (Linux) / `nssm dump ScalpingV2Backend` (Windows)
- Verify Python venv path: `ls /opt/scalping_v2/download/python-backend/venv/bin/python`
- Verify .env exists + readable by service user

**502 Bad Gateway (Nginx)**
- Backend not running: `systemctl status scalping-v2`
- Port mismatch: verify `proxy_pass http://127.0.0.1:8000` matches backend port
- SELinux (CentOS): `setsebool -P httpd_can_network_connect 1`

**WebSocket won't connect**
- Nginx config missing `Upgrade` / `Connection` headers — see Step 6
- Cloudflare: enable WebSocket in Network settings
- Firewall blocking: `ufw allow 80,443`

**TLS certificate expired**
- Auto-renew failed: `sudo certbot renew --dry-run` to test
- Manually renew: `sudo certbot renew`

**Database locked**
- Multiple backend instances running: `ps aux | grep python` (kill duplicates)
- SQLite + Docker: ensure volume is shared, not bind-mounted per container

---

*Last updated: Scalping V2 v2.0.0 · Frontend-100 · Edisi Scalping · Z.ai 2026*
