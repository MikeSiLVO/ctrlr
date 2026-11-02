# Security

## Supported versions

Security fixes go into the latest release only.

## Reporting a vulnerability

Report it privately with the **Report a vulnerability** button on this repository's Security tab. Please don't open a public issue for it.

Include the Ctrl+R version, your OS, the connection type (SSH, SCGI, HTTP or XML-RPC) and the steps to reproduce.

## Scope

In scope is anything Ctrl+R does itself:

- Passwords kept in the OS keyring, and the files in `~/.ctrlr`
- SSH host key checking and the SSH, SCGI, HTTP and XML-RPC connections
- Anything that lets another user or host reach your rTorrent instance through Ctrl+R
- Reading `.torrent` files, magnet links and RSS feeds from untrusted sources

rTorrent itself and your seedbox provider are out of scope. Report those to rTorrent or to your provider.
