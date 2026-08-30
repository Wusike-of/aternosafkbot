# 🤖 Aternos AFK Bot

Bot que mantém o servidor Aternos online ficando logado como jogador AFK.

## Deploy no Render

1. Crie um **Web Service** no Render apontando pra este repo
2. Configure as variáveis de ambiente (ver abaixo)
3. Aponte o UptimeRobot/Frailbot pra `https://SEU-APP.onrender.com/health`

## Variáveis de ambiente

| Key | Value |
|---|---|
| `SERVER_HOST` | `wusikeeee-xzg2.aternos.me` |
| `SERVER_PORT` | `25565` |
| `BOT_USERNAME` | `AFK_Bot` |
| `MC_VERSION` | `26.2` |
| `AFK_INTERVAL` | `30000` |

## Endpoints

- `GET /` — Status do bot (JSON)
- `GET /health` — Health check pro UptimeRobot
