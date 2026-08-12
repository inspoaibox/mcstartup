# Coodesker Desktop Integration Reference

## Scope and provenance

This directory records interoperability observations made against the locally
installed Coodesker application on 2026-08-07. It is an architecture reference
only. It contains no copied executable, DLL, decompiled code, proprietary
algorithm, or source code from Coodesker.

The reference binary remains outside this repository:

| File | Version | SHA-256 |
| --- | --- | --- |
| `C:\Users\nfksu\AppData\Roaming\Coodesker\Native-x64.dll` | 2.2.2.1 | `9135351BDED0AC9FFCA94B75D1C8C57C31F7E4AD2A546F0DFD94293404A06633` |
| `C:\Users\nfksu\AppData\Roaming\Coodesker\Coodesker-x64.exe` | n/a | `75CD5E0AE4F3DDEED28CE9097E002D845797ABE549A8DB96764972118C486D1B` |

`Native-x64.dll` has a valid Authenticode signature from Beijing Coodesker
Technology Co., Ltd. No code or binary from it may be bundled, linked, loaded,
or copied by McStartUP.

## Verified runtime facts

1. The real desktop window tree is owned by Explorer:
   `WorkerW -> SHELLDLL_DefView -> SysListView32 (FolderView)`.
2. During inspection, the Explorer process owning that tree also had
   `C:\Users\nfksu\AppData\Roaming\Coodesker\Native-x64.dll` loaded.
   A second Explorer process did not load it.
3. Coodesker itself did not expose a visible desktop-sized top-level window;
   the observed process window was a hidden message window.
4. Coodesker's managed desktop items remain ordinary files in the real desktop
   directory. The installed Coodesker directory contains small cache files
   (`desk.cache`, `mirror.cache`, `widgets.cache`) rather than moved desktop
   files.
5. There is no Coodesker `CLSID` or `Explorer\Desktop\NameSpace` registration
   under the inspected HKCU/HKLM locations. This is not a Shell Namespace
   Extension implementation.

## Interface evidence from the public PE import/export tables

The native DLL directly imports these Windows APIs:

- Shell item and desktop access: `SHGetDesktopFolder`, `SHParseDisplayName`.
- Shell drag and drop: `RegisterDragDrop`, `RevokeDragDrop`.
- Desktop window discovery/control: `FindWindowExW`, `SendMessageW`,
  `SetParent`, `SetWindowPos`.
- File-system change observation: `ReadDirectoryChangesW`.

Its public exports are `Startup`, `Startup2`, `Shutdown`, `activate`,
`deactivate`, and `envToEncStr`. The PE file also has `.detourc` and `.detourd`
sections, which is evidence of a Detours-based in-process native integration.
It does not identify the individual functions being intercepted, so this record
does not assert a specific hook implementation.

## Architectural conclusion

Coodesker keeps a single source of truth for the file system: files stay on the
Windows desktop. Group membership, order, geometry, and visual state are kept
separately as metadata. Its native Explorer integration then works against the
actual Desktop Folder View, allowing Explorer and file-selection dialogs to
continue enumerating the original files.

McStartUP currently takes the opposite path for ordinary file drops:

1. It receives a desktop path.
2. It moves that file to `%APPDATA%\McStartUP\desktop_boxes\<box-id>`.
3. It stores the moved location as the BOX item.

That behavior is implemented by `move_path_to_box_storage` in
`src-tauri/src/desktop_layouts.rs`, which calls `fs::rename`. As a direct
consequence, the original Desktop folder no longer contains that file, so a
standard Windows file picker cannot list it under Desktop.

## Principles that may be independently implemented

These are design principles, not a request to reproduce Coodesker's private
implementation:

1. Preserve the real desktop path for normal file-backed BOX items. Store the
   BOX assignment, sort index, geometry, and display preferences as metadata.
2. Use stable shell-aware identity for virtual desktop objects such as This PC,
   Recycle Bin, and Control Panel. A file-system path alone cannot represent
   them.
3. Watch for rename, delete, and external desktop changes, then update metadata
   without moving user files.
4. Treat Explorer restarts as a lifecycle boundary. Remove integrations before
   app shutdown and rebuild them only after the live desktop host is available.
5. Keep any native desktop integration behind a small, independently tested
   Windows-only boundary. Explorer is a shared system process; an error there
   must never hide or lose desktop items.

## Non-goals and constraint

There is no documented, supported Windows extension point for a third-party
application to add named container groups directly to the legacy Desktop Folder
View. Running private code inside Explorer, or copying another product's DLL,
is not an acceptable implementation strategy for McStartUP. Any future native
integration must be newly written, owned by this project, and based only on
public Windows interfaces.
