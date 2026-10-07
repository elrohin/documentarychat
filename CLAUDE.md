# Notes for Claude sessions

This repo is the travel-map site, but Rohin also uses sessions opened on it to work on his
home network and servers. Read this before any home/server task.

## Read the notes first
Before any home/server task, read the newest `START-HERE` notes (and any `CORRECTION` notes
from the same date) in Rohin's Google Drive Claude notes folder. They hold the current
state of the house, what was tried, and what not to touch. Search Drive for
`title contains 'START-HERE'` and sort by date.

When a session learns something new about the house, write it back there as a new dated
note, so the next session doesn't have to rediscover it.

## Reaching the house from a cloud session
- `ssh mini` works: `~/.ssh/config` maps it to a local `wstunnel` client on
  `127.0.0.1:2222` → `sshgate.documentarychat.org` → the mini (192.168.1.42).
  The raw LAN addresses are not reachable from the cloud container directly.
- The mini's shell is **PowerShell 5.1**. Send plain commands, or `scp` a readable script
  and run it.
- **Never use `powershell -EncodedCommand`.** Windows Defender flags it as a trojan
  (`Trojan:Win32/Commando.A!ml`) and pops up alerts on Rohin's computer.
- Docker image pulls over SSH fail on the Windows credential helper; use a temporary
  `DOCKER_CONFIG` folder whose `config.json` is `{"auths":{"placeholder.invalid":{}}}`.
- Home Assistant (192.168.1.224) from the mini:
  `ssh -c aes256-gcm@openssh.com hassio@192.168.1.224`, and run scripts with
  `cmd /c "ssh ... bash -s < C:\path\script.sh"`. The HA API token is in
  `/homeassistant/.claude_token` (read with `sudo -n cat`; never print it).
- The Minisforum is `ssh 192.168.1.165` from the mini (use the IP, not the name).

### Everything else is reachable from the mini too (check here before saying "I can't get in")
| Machine | How (run from the mini) |
|---|---|
| **Hubitat** C-8 Pro, 192.168.1.6 (no login) | `docker exec homewatch python /data/hub.py <cmd>`: `devices`, `room <id> <roomId>`, `label`, `maker add <id..>` (shares a device with HA), `pair 90`, `cmd <id> on`. Room ids: `rooms`. |
| **Mac** (MacBookPro, 192.168.1.112) | `ssh rohinelangovan@192.168.1.112` (key-only; reads ~/Library/Messages) |
| **Z13** (192.168.1.119, Windows) | `ssh 192.168.1.119` (user elang); drop files in `Downloads\` |
| **Shield** (192.168.1.80, SDR) | `adb -s 192.168.1.80:5555 shell ...`; radios started by `/data/local/sdr/start-all.sh` |
| **Proxmox laptop** (192.168.1.90) | `docker run --rm -i -v pvekeys:/keys kroniak/ssh-client ssh -i /keys/id -o StrictHostKeyChecking=no root@192.168.1.90 bash -s < script` |
| **UniFi** | HA's `unifi` integration (device trackers); PoE per port is set in the UniFi app |

Home Assistant also links Hubitat (Maker API, app 17) and Matter. A new Hubitat device shows up in HA after
`hub.py maker add <id>` plus a reload of HA's hubitat config entry.

## Ask before
- Restarting Home Assistant or the mini, or anything that interrupts the house.
- Re-enabling anything a note says Rohin turned off (for example `amie-watch` / The Daily).
- Changing a TV or receiver input: never switch sources while the TV is on or the
  Apple TV is playing.

## One-off commands: never leave them running
On 2026-10-07 two quick lookups left by earlier sessions (`docker exec quiznight python -c ...`
and the same in `heard`) had been stuck for 12 hours, each using a full CPU core. Both used
`glob('/**/x.db', recursive=True)`, which walks `/proc` and `/sys` and never ends. A
"scissor search" container had also been left running with 4.7 GB of memory. Rules:
- **Never search the whole filesystem** (`glob('/**')`, `find /`, `grep -r /`, `du /`). Use the
  known path from the compose file (`docker inspect` → Mounts) or a single directory.
- **Put a time limit on every ad-hoc command**: `docker exec <c> timeout 60 python -c ...`,
  `timeout 120 <cmd>` on Linux hosts. Containers often lack `kill`, `ps` and `timeout`; if
  `timeout` is missing, use `python3 -c` with `signal.alarm(60)`.
- **Clean up before you finish**: one-off containers (`docker run --rm`, never a named
  long-lived one for a single job), background jobs, temp scripts. A finished experiment gets
  removed, or written up in the Drive notes as something that is meant to keep running.
- **Heavy jobs get limits** (`cpus:`/`mem_limit` in compose, `CPUQuota=`/`Nice=` in systemd).
  The Proxmox laptop (192.168.1.90) in particular runs hot: keep its jobs single-threaded.
- **Check for leftovers**: a process in a container that isn't PID 1 and has run for hours is
  almost always an old session's leftover. To stop it when `kill` is missing:
  `docker exec <c> python3 -c "import os,signal; os.kill(<pid>, signal.SIGTERM)"`.
