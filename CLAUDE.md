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

## Ask before
- Restarting Home Assistant or the mini, or anything that interrupts the house.
- Re-enabling anything a note says Rohin turned off (for example `amie-watch` / The Daily).
- Changing a TV or receiver input: never switch sources while the TV is on or the
  Apple TV is playing.
