# McStartUP Desktop Icon Filter

This is a Windows-only experimental companion DLL for Desktop BOX. It is
owned and built by McStartUP; it does not load, copy, or depend on Coodesker.

## Contract

- The file remains in the real Desktop directory.
- Explorer and file dialogs continue to enumerate that file normally.
- The DLL only suppresses Explorer `SysListView32` painting and mouse hit
  handling for a BOX-assigned item whose visible label is unique on the
  desktop. The original icon cannot be opened or right-clicked at its former
  desktop coordinate.
- Ambiguous labels, invalid configuration, a missing hook, or an expired lease
  leave Explorer's original icon drawing intact.

## Lifecycle

`src-tauri/src/desktop_icon_filter.rs` writes a small atomic configuration in
`%APPDATA%\\McStartUP\\desktop_box_icon_filter.json` and refreshes a 15-second
lease every five seconds. The DLL subclasses only the desktop Folder View from
a thread-specific `WH_GETMESSAGE` hook and returns `CDRF_SKIPDEFAULT` for a
matched `NM_CUSTOMDRAW` item.

On normal exit McStartUP disables the configuration, restores the original
Folder View procedure, and removes the hook. If the process exits unexpectedly,
the DLL timer detects the expired lease and invalidates the desktop so Explorer
returns to its normal rendering.

This uses documented Win32 window, hook, List-View custom-draw, and file APIs,
but Explorer subclassing is inherently version-sensitive. The feature is
therefore deliberately isolated from normal BOX persistence and always fails
open. Once the hook enters Explorer, the DLL is pinned for that Explorer
process lifetime. This prevents an abrupt McStartUP exit from leaving the
Folder View window procedure pointing at unloaded code. The lease timer
restores the original procedure when the host stops renewing the lease.
