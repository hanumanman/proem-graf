# proem-graf

Proemion polls into InfluxDB 3 Core. Grafana reads that.

## Serve

Docker Engine and Compose v2 have to be installed already. `./bootstrap` does not install them and does not use sudo.

```bash
cp .env.example .env
```

Fill `PROEMION_CLIENT_ID`, `PROEMION_CLIENT_SECRET`, and `GF_SECURITY_ADMIN_PASSWORD`. Leave `INFLUX_ADMIN_TOKEN` empty on a new machine.

```bash
./bootstrap
```

Grafana is on port 3000, user `admin`, password from `.env`. Influx stays on `127.0.0.1:8181`.

Running `./bootstrap` again does not rotate an existing operator token. If Influx already has a token and `.env` does not, the script stops.

After a reboot the stack comes back only if the Docker daemon does (`sudo systemctl enable --now docker` on Linux). Compose uses `restart: unless-stopped`.

## Collector development

Host Bun 1.2. Commands are in `collector/README.md`. Not required to serve.
