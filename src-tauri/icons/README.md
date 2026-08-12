# Icons Directory

This directory should contain the application icons.

## Required Icons

For a complete Tauri application, you need:
- `32x32.png` - 32x32 pixel icon
- `128x128.png` - 128x128 pixel icon
- `128x128@2x.png` - 256x256 pixel icon (for retina displays)
- `icon.icns` - macOS icon (if building for macOS)
- `icon.ico` - Windows icon

## Generating Icons

You can use the Tauri CLI to generate icons from a single source image:

```bash
npm install -g @tauri-apps/cli
tauri icon path/to/your/icon.png
```

The source image should be at least 1024x1024 pixels.

## Temporary Solution

For development, icons are optional. The application will use default icons.
Once you have a logo, generate the proper icons using the command above.
