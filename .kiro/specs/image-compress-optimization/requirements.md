# Requirements Document

## Introduction

Optimize the existing ImageCompressTool in a Tauri v1.5 desktop application. The current tool supports single-image JPEG/WebP/PNG compression with a quality slider, before/after side-by-side preview, and file upload/drag-drop/paste input. This feature set adds batch processing, an interactive comparison slider, smart presets, AVIF format support, lossless optimization, size constraints, watermark overlay, history/config persistence, performance improvements (file-path I/O, async commands, fast preview), and UX enhancements (reset, estimated time, keyboard shortcuts, auto-copy).

## Glossary

- **Compress_Tool**: The ImageCompressTool React component and its associated Rust backend commands responsible for image compression
- **Rust_Backend**: The Tauri Rust backend (`commands.rs`) that performs image encoding/decoding via the `image` crate
- **Comparison_Slider**: A draggable left-right slider overlay that reveals the original image on one side and the compressed image on the other
- **Preset**: A named set of compression parameters (format, quality, max dimensions) that can be applied with a single click
- **Batch_Queue**: An ordered list of images queued for compression, each tracked with individual progress status
- **Lossless_Optimizer**: A backend module that applies lossless compression algorithms (oxipng for PNG, mozjpeg for JPEG) to reduce file size without quality loss
- **Watermark_Overlay**: A text or image stamp composited onto the compressed output
- **Compression_History**: A persistent record of recent compression operations and their parameters stored via Tauri's `save_tool_data`/`load_tool_data` commands
- **Fast_Preview**: A low-resolution preview image generated quickly to provide immediate visual feedback while full compression runs in the background

## Requirements

### Requirement 1: Batch Compression

**User Story:** As a user, I want to select and compress multiple images at once, so that I can process a batch of files efficiently without repeating the workflow for each image.

#### Acceptance Criteria

1. WHEN multiple files are selected via the file input dialog, THE Compress_Tool SHALL add all selected image files to the Batch_Queue
2. WHEN files are dropped onto the upload area, THE Compress_Tool SHALL add all dropped image files to the Batch_Queue
3. WHILE the Batch_Queue contains unprocessed images, THE Compress_Tool SHALL display a progress bar for each image showing its compression status (pending, processing, completed, failed)
4. WHEN batch compression is initiated, THE Rust_Backend SHALL process each image in the Batch_Queue sequentially using the current compression parameters
5. WHEN an individual image in the Batch_Queue fails to compress, THE Compress_Tool SHALL mark that image as failed with an error message and continue processing the remaining images
6. WHEN all images in the Batch_Queue have been processed, THE Compress_Tool SHALL display a summary showing total original size, total compressed size, and overall compression ratio
7. WHEN the user clicks a batch download button, THE Compress_Tool SHALL allow downloading all successfully compressed images

### Requirement 2: Comparison Slider

**User Story:** As a user, I want to compare the original and compressed images using a draggable left-right slider, so that I can visually assess compression quality at any point in the image.

#### Acceptance Criteria

1. WHEN a compressed image is available, THE Compress_Tool SHALL display a Comparison_Slider overlay with the original image on the left and the compressed image on the right
2. WHEN the user drags the slider handle horizontally, THE Comparison_Slider SHALL update the visible boundary between original and compressed images in real time
3. THE Comparison_Slider SHALL default the divider position to 50% of the image width
4. WHILE the Comparison_Slider is active, THE Compress_Tool SHALL display labels indicating which side is "Original" and which is "Compressed"

### Requirement 3: Smart Presets

**User Story:** As a user, I want to apply predefined compression presets with a single click, so that I can quickly optimize images for common use cases without manually adjusting parameters.

#### Acceptance Criteria

1. THE Compress_Tool SHALL provide the following Preset buttons: "Web Optimization", "WeChat Send", "Print", and "Maximum Compression"
2. WHEN the user clicks the "Web Optimization" Preset, THE Compress_Tool SHALL set format to WebP, quality to 80, and max long edge to 1920px
3. WHEN the user clicks the "WeChat Send" Preset, THE Compress_Tool SHALL set format to JPEG, quality to 70, and max long edge to 1280px
4. WHEN the user clicks the "Print" Preset, THE Compress_Tool SHALL set format to PNG, quality to 95, and apply no dimension constraints
5. WHEN the user clicks the "Maximum Compression" Preset, THE Compress_Tool SHALL set format to WebP, quality to 30, and max long edge to 1200px
6. WHEN a Preset is applied, THE Compress_Tool SHALL trigger a new compression with the updated parameters

### Requirement 4: AVIF Format Support

**User Story:** As a user, I want to compress images to AVIF format, so that I can achieve better compression ratios for modern browsers and platforms.

#### Acceptance Criteria

1. THE Compress_Tool SHALL include "AVIF" as a selectable output format alongside JPEG, WebP, and PNG
2. WHEN AVIF format is selected, THE Rust_Backend SHALL encode the image using AVIF encoding with the specified quality parameter
3. WHEN AVIF encoding succeeds, THE Rust_Backend SHALL return the compressed image data with MIME type "image/avif"
4. IF AVIF encoding fails, THEN THE Rust_Backend SHALL return a descriptive error message indicating the failure reason

### Requirement 5: Lossless Optimization

**User Story:** As a user, I want lossless optimization for PNG and JPEG images, so that I can reduce file size without any quality degradation.

#### Acceptance Criteria

1. THE Compress_Tool SHALL provide a "Lossless" toggle option in the compression parameters panel
2. WHEN lossless mode is enabled and format is PNG, THE Rust_Backend SHALL apply oxipng-level lossless optimization to the PNG output
3. WHEN lossless mode is enabled and format is JPEG, THE Rust_Backend SHALL apply mozjpeg lossless optimization to the JPEG output
4. WHILE lossless mode is enabled, THE Compress_Tool SHALL hide the quality slider since quality is not applicable
5. IF lossless optimization is selected for a format that does not support lossless mode (WebP lossy, AVIF lossy), THEN THE Compress_Tool SHALL display a notice and fall back to the highest quality setting

### Requirement 6: Size Constraints

**User Story:** As a user, I want to set maximum width, height, or long-edge limits, so that I can ensure compressed images fit within specific dimension requirements while preserving aspect ratio.

#### Acceptance Criteria

1. THE Compress_Tool SHALL provide input fields for maximum width, maximum height, and maximum long edge in pixels
2. WHEN a maximum long-edge value is set, THE Rust_Backend SHALL resize the image so that the longer dimension does not exceed the specified value while preserving the original aspect ratio
3. WHEN both maximum width and maximum height are set, THE Rust_Backend SHALL resize the image to fit within the specified bounding box while preserving the original aspect ratio
4. WHEN the original image dimensions are already within the specified constraints, THE Rust_Backend SHALL not resize the image
5. THE Rust_Backend SHALL apply dimension constraints before compression encoding

### Requirement 7: Watermark Overlay

**User Story:** As a user, I want to add a simple text watermark to compressed images, so that I can protect my images with attribution or branding.

#### Acceptance Criteria

1. THE Compress_Tool SHALL provide a text input field for watermark content and position selector (top-left, top-right, bottom-left, bottom-right, center)
2. WHEN watermark text is provided, THE Rust_Backend SHALL composite the text onto the image at the specified position before compression encoding
3. THE Rust_Backend SHALL render the watermark text with a semi-transparent white color and a dark shadow for readability on varied backgrounds
4. WHEN watermark text is empty, THE Rust_Backend SHALL not apply any watermark overlay

### Requirement 8: Compression History and Export Config

**User Story:** As a user, I want to save and recall recent compression parameters, so that I can quickly reuse settings from previous sessions.

#### Acceptance Criteria

1. WHEN a compression operation completes, THE Compress_Tool SHALL save the compression parameters (format, quality, lossless flag, dimension constraints, preset name) to Compression_History
2. THE Compress_Tool SHALL display the 10 most recent Compression_History entries in a dropdown or list
3. WHEN the user selects a Compression_History entry, THE Compress_Tool SHALL apply the saved parameters to the current session
4. THE Compress_Tool SHALL persist Compression_History across application restarts using the existing `save_tool_data`/`load_tool_data` Tauri commands

### Requirement 9: File-Path Based Processing

**User Story:** As a user, I want the backend to process images directly from disk file paths, so that large images do not need to be transferred as Base64 strings between frontend and backend.

#### Acceptance Criteria

1. WHEN an image is loaded from a file input or drag-drop, THE Compress_Tool SHALL pass the file path to the Rust_Backend instead of Base64 data
2. THE Rust_Backend SHALL provide an async Tauri command `image_compress_file` that accepts a file path, format, quality, and optional dimension constraints, and returns the compressed image as a Base64 data URL
3. WHEN the file path is invalid or the file cannot be read, THE Rust_Backend SHALL return a descriptive error message
4. THE Compress_Tool SHALL fall back to Base64 transfer for clipboard-pasted images that do not have a file path

### Requirement 10: Async Processing

**User Story:** As a user, I want image compression to run asynchronously, so that the UI remains responsive while processing large images.

#### Acceptance Criteria

1. THE Rust_Backend SHALL implement all new compression commands as async Tauri commands using `#[tauri::command(async)]` or `async fn`
2. WHILE an async compression operation is in progress, THE Compress_Tool SHALL display a loading indicator and remain interactive
3. WHEN the user changes parameters while a compression is in progress, THE Compress_Tool SHALL cancel the pending operation and start a new one with the updated parameters

### Requirement 11: Low-Quality Fast Preview

**User Story:** As a user, I want to see a quick low-resolution preview while full compression runs in the background, so that I get immediate visual feedback.

#### Acceptance Criteria

1. WHEN compression parameters change, THE Compress_Tool SHALL immediately request a Fast_Preview by compressing a downscaled version of the image (max 400px long edge)
2. WHILE the full-resolution compression is in progress, THE Compress_Tool SHALL display the Fast_Preview in the comparison area
3. WHEN the full-resolution compression completes, THE Compress_Tool SHALL replace the Fast_Preview with the full-resolution compressed image

### Requirement 12: Reset Button

**User Story:** As a user, I want a reset button, so that I can quickly clear the current image and all parameters to start fresh.

#### Acceptance Criteria

1. WHEN an image is loaded, THE Compress_Tool SHALL display a reset button
2. WHEN the user clicks the reset button, THE Compress_Tool SHALL clear the loaded image, compressed result, all parameter values, and return to the initial upload state

### Requirement 13: Estimated Compression Time

**User Story:** As a user, I want to see an estimated compression time for large images, so that I know how long to wait.

#### Acceptance Criteria

1. WHEN an image larger than 2MB is loaded, THE Compress_Tool SHALL display an estimated compression time based on the image file size
2. WHILE compression is in progress for a large image, THE Compress_Tool SHALL display an elapsed time counter

### Requirement 14: Keyboard Shortcuts

**User Story:** As a user, I want keyboard shortcuts for common actions, so that I can work more efficiently.

#### Acceptance Criteria

1. WHEN the user presses Ctrl+Enter while an image is loaded, THE Compress_Tool SHALL trigger manual compression
2. WHEN the user presses Ctrl+S while a compressed image is available, THE Compress_Tool SHALL trigger the download action
3. WHEN the user presses Ctrl+R while an image is loaded, THE Compress_Tool SHALL trigger the reset action

### Requirement 15: Auto-Copy to Clipboard

**User Story:** As a user, I want an option to automatically copy the compressed image to the clipboard after compression, so that I can paste it directly into other applications.

#### Acceptance Criteria

1. THE Compress_Tool SHALL provide a toggle for "Auto-copy to clipboard after compression"
2. WHEN auto-copy is enabled and compression completes, THE Compress_Tool SHALL copy the compressed image data to the system clipboard
3. WHEN auto-copy succeeds, THE Compress_Tool SHALL display a brief toast notification confirming the copy
4. IF clipboard copy fails, THEN THE Compress_Tool SHALL display an error notification without blocking the compression result
