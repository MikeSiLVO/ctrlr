# Changelog

## [1.2.0] - 2026-11-02

### Security
- SSH connections no longer open a port on 127.0.0.1. While connected, any program on the computer could use that port to send commands to rTorrent, including ones that run shell commands on the server

### Added
- The Files tab sorts by any column inside the folder tree, with Expand all and Collapse all
- Folder rows in the Files tab have folder icons and indent guides
- The activity log shows entries from earlier sessions, with a separator for each day
- When an SSH profile's server can't be reached at launch, Ctrl+R keeps retrying with a countdown on the Connection screen and opens the main window once it connects. A wrong password or changed host key is not retried
- A magnet still fetching its metadata shows its own name and a "Fetching metadata" status
- History sorts by name, size, date added or status, and filters to Active or Removed entries
- Ctrl+R checks GitHub for a new release at launch and once a day, and shows it in the status bar. The check can be turned off in Settings, and the About tab has a Check for Updates button
- Ctrl+R remembers which ratio groups are on for each server and turns them back on after rTorrent restarts, with a notification and an activity log entry

### Changed
- Ctrl+R uses less network traffic while hidden in the tray. Notifications and the tray tooltip stay current
- When rTorrent goes down the SSH session stays connected, and reconnect attempts back off from 2 seconds up to a minute
- The torrents total in the status bar counts downloaded data, so a partly downloaded torrent counts only what is on disk
- The RSS feed Refresh button is merged into Preview
- An RSS rule is refused on save when its pattern or exclude doesn't compile, or when the exclude matches every title, such as `720p|`
- Sort arrows and chevrons are drawn as icons, one size across the app
- Database failures show in the activity log
- A failed connect at launch shows its error, with the saved profile selected and filled in
- History shows a torrent as Active only while it is loaded, so removals made in ruTorrent or elsewhere show as Removed, and an Active entry offers no Re-add
- The Add dialog marks a magnet that is already loaded, as it does a .torrent file
- The Files and Peers tab menus and the speed preset menu match the torrent menu, and every menu stays inside the window
- A failing RSS feed reports its HTTP status
- Updated dependencies, including russh, quick-xml, feed-rs, rusqlite, rustls and Vite

### Fixed
- Whatbox disk space was rounded to whole gigabytes
- Moving a torrent started it even when it was stopped or paused
- A torrent removed after being re-added could lose its saved .torrent in History
- Adding or renaming a profile to a name already in use overwrote that profile
- Renaming a profile could lose its saved password
- Deleting a profile that was never saved failed, and other delete errors didn't show
- RSS rules with quality preferences downloaded the same episode again when neither copy named a quality
- XML-RPC replies with empty values such as `<string/>` were misread
- An SCGI error reply was read as data instead of shown as an error
- A batch remove that failed partway didn't say how many were removed or why
- A failed re-add from History showed no error
- Escape didn't close the Add dialog, and keys like Delete reached the torrent list behind it
- Keys pressed with a context menu or the speed menu open reached the window behind it. Escape now closes just the menu
- Magnet names with `+` showed the plus instead of a space
- History action buttons wrapped onto two lines
- History said "No history yet" when a source filter matched nothing
- The About tab's releases link didn't open in the default browser
- The Add dialog's Save to was ignored for magnets and URLs
- A torrent with several files, added with Save to or by an RSS rule with a Directory, put its files straight into that folder instead of a folder of its own
- Ratio group upload limits entered in GB or TB came out 2 to 5% low
- Right-clicking a peer opened an empty menu on servers that can't disconnect or ban peers
- Leaving the Connection tab while adding a profile asked for the name again on return
- With Ctrl+R running, a clicked magnet showed up twice in the Add dialog
- History never marked a torrent added from a .torrent file as removed
- History saved rTorrent's placeholder in place of a magnet's .torrent, and never fetched the real one
- A profile, RSS or scheduler change could overwrite a settings file Ctrl+R had failed to read, losing what was in it
- Ratio groups that were off showed as on, so saving the Ratio tab could turn them on
- Renaming an RSS feed left the old feed in place and still polling, and rules watching it lost the feed
- An RSS rule's .torrent download that failed with an HTTP error was sent to rTorrent as the file and never retried
- Comments set in ruTorrent showed `%20` and other codes instead of spaces and symbols
- First and last piece priority on a file took effect only after the next priority change
- Escape didn't close the Files and Peers tab menus, the connection menu or the column menu
- A confirmation that opened while another was showing left the first action waiting forever
- Enter on a dialog's Cancel button confirmed instead of canceling
- A comma typed into an RSS rule's quality list disappeared
- With a mix of paused and running torrents selected, the toolbar said Pause while the button resumed them
- Restoring the window from the tray left it minimized when it had been minimized before hiding
- The speed graph drew older samples over its axis labels
- XML-RPC errors were labeled JSON-RPC

## [1.1.1] - 2026-07-22

### Added
- Exporting a .torrent now asks where to save it, instead of dropping it in the downloads folder unprompted

### Changed
- Escape closes the history, RSS, settings, properties and directory dialogs
- Updated to Tauri 2.11
- The bundle identifier is now `io.github.mikesilvo.ctrlr`, a name actually tied to the project rather than a domain nobody owns. Upgrading from 1.0.x starts with default settings and window position, since the webview stores them per identifier
- The macOS build is now universal, so it runs natively on Intel as well as Apple Silicon. Previous releases shipped an Apple Silicon binary despite claiming otherwise
- RSS download history and archived .torrent blobs are pruned, so the database no longer grows without bound
- RSS rules gained a Throttle field in the editor
- Tracker scrape columns and `d.tracker_numwant` are gated on server support, instead of breaking the whole detail panel on servers without them

### Fixed
- Torrents with skipped files show "Seeding" and correct progress once every wanted file is downloaded. Progress, ETA, sidebar filters and completion notifications all read wanted chunks rather than the whole torrent
- Adding a torrent with only some files selected could leave it stopped and unstartable, because the add flow forced a hash check after starting
- Download directories containing a comma, semicolon or quote were rejected by rTorrent, which silently left the added torrent unstartable
- Adding a torrent that rTorrent refuses to start now reports rTorrent's own error instead of failing quietly
- RSS rules apply their Directory, Label and Throttle. All three were configurable and did nothing, and the history row claimed the directory had been used
- An invalid RSS exclude pattern no longer downloads exactly what the rule was written to block
- A manual RSS feed refresh no longer suppresses the automatic poll for that feed
- One unreachable RSS feed host could hang every RSS action for the rest of the session
- Episode parsing: `1920x1080` no longer reads as season 20 episode 108, and `S01E02-03` ranges work without `S01E01-2160p` reading as episodes 1 to 216
- The SSH tunnel could report healthy after its accept loop died, so auto-reconnect never fired again until restart
- Reconnecting could fail with "address in use" because the old listener had not been released
- Every transport now has a connect and request deadline. A seedbox that accepted a connection then went quiet used to hang polling indefinitely while still showing as connected
- A failed connect no longer destroys the working connection or leaves the app pointing at a profile that could not connect
- The bandwidth scheduler reasserts its limits after a reconnect or profile switch instead of leaving the new server unthrottled
- Toggling RSS or the scheduler off and on quickly could leave it enabled in the UI with nothing running
- Quitting from the tray now stops the RSS and scheduler loops, as quitting from the window already did
- Removing several torrents at once records the ones that were removed when a later one fails, instead of retrying them forever
- Default trackers are no longer added to a torrent whose private flag could not be read
- Priority dropdowns in the add dialog and Files tab were clipped by their scroll containers
- The folder priority "Mixed" entry was selectable and set the whole folder to Off
- File and folder priority changes no longer snap back until the next poll, and no longer leak between torrents
- The settings dialog is one size for every tab, so the sidebar no longer slides out from under the cursor
- The connection tab could blank its form and then save an empty profile over a real one
- The Trackers tab hid the add form for a torrent with no trackers, which is when it is needed
- Switching profiles no longer shows the previous server's torrents for a poll
- Dates in the detail panel now match the format used in the table
- Malformed config files report the parse error instead of silently connecting to localhost:5000
- Hostile or corrupt .torrent files are rejected rather than overflowing the stack or panicking
- Demo mode crashed on the directory browser and hung on the properties dialog
- On macOS, a magnet opened while the app was closed was dropped instead of being added
- Pausing or resuming a selection could leave some torrents untouched when one of them had gone from the server
- Selecting Português (BR) or 简体中文 showed English, and the language picker displayed a truncated locale tag
- Escape over a confirmation closed the dialog behind it and left the confirmation stranded; Escape in an open dropdown closed the whole settings dialog
- Delete and P still reached the torrent list while a dialog was open
- A dropdown stayed open over unrelated rows after the row it belonged to scrolled out of view
- A .torrent or magnet opened at startup could be dropped if it arrived while the window was still loading
- Failing to save an exported .torrent reported nothing, so the export looked like it had worked
- Resuming a torrent with skipped files announced "Download complete" again every time
- Switching profiles could fire notifications by comparing one server's torrents against another's
- Archived .torrent blobs were never pruned; the query named a column that does not exist
- A dropped SSH session went unnoticed, so every request waited out its full timeout with no reconnect, and quitting could hang behind it
- A first run with no config file made no connection attempt at all
- The cold-start screen rendered unstyled, because the content security policy blocked the inline styles it used
- Turning RSS off just as a match was added could download the same episode again later
- The disk space reading could show the previous provider's figure for up to 30 seconds after switching
- The language picker listed raw locale tags, and the same profile name could be added twice
- Opening a torrent by double-clicking a .torrent or a magnet link did nothing; the dialog never appeared
- A second file dropped onto an already-open add dialog was silently ignored
- Pressing Ctrl+N behind the connection dialog queued an add dialog that popped up unbidden once connected
- A hand-edited or corrupt setting in local storage could blank the window on launch

### Security
- `rss.toml` is written 0600 like `config.toml`. It holds private tracker passkeys and session cookies
- Response bodies are capped, including chunked replies that carry no declared length, and deeply nested bencode is rejected before it reaches the parser that would abort the process on it
- The webview now runs under a content security policy, so nothing rendered from a feed can load or call out to a remote host
- Updated dependencies clear six advisories, three of them high, in the dev server and bundler

### Removed
- Around 600 lines of unreachable code: 27 unused library methods, nine Tauri commands with no caller, and the `feed-rs` dependency from `ctrlr-core`

## [1.0.1] - 2026-02-27

### Fixed
- Minor internal cleanup (lock scoping, error handling)

## [1.0.0] - 2026-02-24

Initial public release.

### Fixed
- App icon blurry on Windows (`.ico` was missing higher-resolution layers)
- Release artifacts now have platform-friendly filenames

### Added
- Full torrent management: add (magnet/file/URL), pause, resume, remove, recheck, reannounce
- Detail panel with General, Files (folder tree), Peers, Trackers, and Speed Graph tabs
- Multi-add dialog with per-torrent options, file selection, and extra trackers
- Connection types: SSH tunnel, TCP/SCGI, HTTP JSON-RPC, XML-RPC over HTTPS
- Multi-instance profiles with quick-switch from toolbar
- RSS feeds with regex rules, smart episode tracking, quality preferences, auto-download
- Bandwidth scheduler with 7x24 grid and named speed profiles
- Torrent history with .torrent blob archive, search, and re-add/export
- Named throttle groups, ratio groups with auto-actions, tag management
- Drag-drop, keyboard shortcuts, deep links, .torrent file associations
- System tray with start minimized and close-to-tray
- Autostart on system boot
- 5 themes: Dark, Light, Midnight, Nord, Dracula
- 7 languages: English, German, Spanish, French, Portuguese (BR), Russian, Chinese
- Activity log persisted to SQLite
- Remote settings management with capability detection
- Disk space monitoring with seedbox provider support
- Cross-platform: Windows (NSIS), macOS (DMG), Linux (DEB/AppImage)

[1.2.0]: https://github.com/MikeSiLVO/ctrlr/releases/tag/v1.2.0
[1.1.1]: https://github.com/MikeSiLVO/ctrlr-releases/releases/tag/v1.1.1
[1.0.1]: https://github.com/MikeSiLVO/ctrlr-releases/releases/tag/v1.0.1
[1.0.0]: https://github.com/MikeSiLVO/ctrlr-releases/releases/tag/v1.0.0
