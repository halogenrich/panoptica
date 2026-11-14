# PANOPTICA's activation service

Run by PANOPTICA, never by a lab. Labs' installers and apps ask it, with the lab's product key, what the key covers, for the
lab's signed licence and for the packages the key covers (installs and updates). Staff manage keys and releases with
`tools/builder/keys.mjs`. Plain Node 22, no dependencies: one file (`server.mjs`) and a data folder.

## Running it

```
ADMIN_TOKEN=<48 random characters> ACTIVATION_DATA=/var/lib/panoptica-activation PORT=8080 node services/activation/server.mjs
```

- **HTTPS**: put it behind a proxy or platform that serves HTTPS (Caddy, nginx, a cloud load balancer). Keys travel in
  requests; plain HTTP is only for tests.
- **Data**: `ACTIVATION_DATA` holds `activation.db` (keys by SHA-256 only, signed licences, the computers that activated each
  key, the releases) and `files/<version>/` (the packages). Back the folder up: it is the list of who bought what.
- **Admin token**: staff send it with every `keys.mjs` command (`ACTIVATION_TOKEN`). Keep it with the signing key's
  custodians; change it by restarting with a new one.
- **The installer's address**: set the repository variable `ACTIVATION_URL` (GitHub › Settings › Variables) to the service's
  HTTPS address; the release workflow builds it into PANOPTICA Setup. Without it the wizard asks for the address.

## A release

After the release workflow publishes `v<version>` on GitHub: `node tools/builder/keys.mjs publish <version>` copies its
packages (`panoptica-<modules>.zip`, with their signatures) to the service. Labs get it at their next check, if their key's
last day of updates covers its date.

## Keys

`keys.mjs new` makes a key (shown once, and on the lab's key card in `out/keys/`), signs the lab's licence with PANOPTICA's
private key on the staff computer and stores it here. `renew` signs a new licence for the same key (renewal, modules added,
more computers); labs fetch it at their next check, or with **Check my licence**. `move` frees a computer's place (a
replaced mini PC). `list` shows every key and its computers.
