# Requirements Document

## Introduction

划词翻译是一个轻量级的翻译功能，允许用户在任何应用中选中文本后，通过快捷键快速翻译，翻译结果显示在鼠标附近的悬浮窗口中。该功能旨在提供无缝的翻译体验，支持多种翻译服务和快捷操作。

## Glossary

- **Word_Selection_Translate_System**: 划词翻译系统，负责处理文本获取、翻译和结果展示的完整流程
- **Floating_Window**: 悬浮窗口，用于在鼠标光标附近显示翻译结果的小型无边框窗口
- **Translation_Service**: 翻译服务，包括百度、谷歌、必应、腾讯、ChatGPT、Gemini等第三方翻译API
- **Clipboard_Manager**: 剪贴板管理器，负责保存和恢复剪贴板内容
- **Hotkey**: 快捷键，用户触发划词翻译功能的键盘组合键
- **Selected_Text**: 选中文本，用户在任意应用中通过鼠标或键盘选中的文本内容
- **Cursor_Position**: 光标位置，鼠标光标在屏幕上的坐标位置

## Requirements

### Requirement 1: 快捷键触发

**User Story:** 作为用户，我希望通过快捷键触发划词翻译，以便快速翻译选中的文本而无需手动复制粘贴。

#### Acceptance Criteria

1. WHEN the user presses the configured hotkey, THE Word_Selection_Translate_System SHALL capture the currently selected text from any application
2. THE Word_Selection_Translate_System SHALL support a default hotkey of Alt+W
3. THE Word_Selection_Translate_System SHALL allow users to customize the hotkey through settings
4. WHEN the hotkey is pressed and no text is selected, THE Word_Selection_Translate_System SHALL display a notification indicating no text is selected
5. WHEN the hotkey conflicts with system or other application shortcuts, THE Word_Selection_Translate_System SHALL display an error message during hotkey registration

### Requirement 2: 文本获取

**User Story:** 作为用户，我希望系统能自动获取我选中的文本，以便无需手动复制即可翻译。

#### Acceptance Criteria

1. WHEN the hotkey is triggered, THE Clipboard_Manager SHALL save the current clipboard content
2. WHEN the clipboard content is saved, THE Word_Selection_Translate_System SHALL simulate Ctrl+C to copy the selected text
3. WHEN the selected text is copied, THE Word_Selection_Translate_System SHALL retrieve the text from the clipboard within 500ms
4. WHEN the text is retrieved, THE Clipboard_Manager SHALL restore the original clipboard content within 100ms
5. IF the clipboard operation fails, THEN THE Word_Selection_Translate_System SHALL display an error message and abort the translation
6. THE Word_Selection_Translate_System SHALL handle text containing special characters, line breaks, and Unicode characters

### Requirement 3: 翻译执行

**User Story:** 作为用户，我希望系统能快速翻译获取的文本，以便立即看到翻译结果。

#### Acceptance Criteria

1. WHEN the selected text is retrieved, THE Word_Selection_Translate_System SHALL invoke the configured Translation_Service with the text
2. THE Word_Selection_Translate_System SHALL support the following Translation_Services: Baidu, Google, Bing, Tencent, ChatGPT, and Gemini
3. THE Word_Selection_Translate_System SHALL use the user-configured source and target languages for translation
4. WHEN the source language is set to "auto", THE Translation_Service SHALL automatically detect the source language
5. WHEN the Translation_Service returns a result, THE Word_Selection_Translate_System SHALL extract the translated text within 100ms
6. IF the Translation_Service returns an error, THEN THE Word_Selection_Translate_System SHALL display the error message in the Floating_Window
7. THE Word_Selection_Translate_System SHALL timeout translation requests after 30 seconds

### Requirement 4: 悬浮窗口显示

**User Story:** 作为用户，我希望翻译结果显示在鼠标附近的悬浮窗口中，以便快速查看而不影响当前工作。

#### Acceptance Criteria

1. WHEN the translation is initiated, THE Word_Selection_Translate_System SHALL create a Floating_Window near the Cursor_Position
2. THE Floating_Window SHALL be positioned within 50 pixels of the Cursor_Position
3. THE Floating_Window SHALL remain within the screen boundaries
4. WHEN the Floating_Window would extend beyond screen boundaries, THE Word_Selection_Translate_System SHALL adjust the position to keep it fully visible
5. THE Floating_Window SHALL be a frameless, always-on-top window
6. THE Floating_Window SHALL have a compact size appropriate for displaying translation results
7. WHEN the translation result is received, THE Floating_Window SHALL display the translated text within 100ms
8. THE Floating_Window SHALL display a loading indicator while translation is in progress

### Requirement 5: 窗口交互

**User Story:** 作为用户，我希望能够与悬浮窗口交互，以便复制译文、朗读译文或关闭窗口。

#### Acceptance Criteria

1. THE Floating_Window SHALL provide a button to copy the translated text to the clipboard
2. WHEN the copy button is clicked, THE Word_Selection_Translate_System SHALL copy the translated text to the clipboard and display a confirmation indicator for 1500ms
3. THE Floating_Window SHALL provide a button to read the translated text aloud using text-to-speech
4. WHEN the read-aloud button is clicked, THE Word_Selection_Translate_System SHALL use the system text-to-speech engine to read the translated text
5. THE Floating_Window SHALL provide a close button to dismiss the window
6. WHEN the close button is clicked, THE Word_Selection_Translate_System SHALL hide the Floating_Window
7. WHEN the user presses the Escape key, THE Word_Selection_Translate_System SHALL hide the Floating_Window
8. WHEN the user clicks outside the Floating_Window, THE Word_Selection_Translate_System SHALL hide the Floating_Window after 3 seconds

### Requirement 6: 翻译服务配置

**User Story:** 作为用户，我希望能够选择和配置不同的翻译服务，以便根据需要使用不同的翻译引擎。

#### Acceptance Criteria

1. THE Word_Selection_Translate_System SHALL allow users to select the Translation_Service from the available options
2. THE Word_Selection_Translate_System SHALL persist the selected Translation_Service in user settings
3. THE Word_Selection_Translate_System SHALL reuse the existing translation service configuration from the quick translate feature
4. WHEN a Translation_Service requires API credentials, THE Word_Selection_Translate_System SHALL validate the credentials before allowing translation
5. IF API credentials are missing or invalid, THEN THE Word_Selection_Translate_System SHALL display an error message with instructions to configure the service

### Requirement 7: 语言配置

**User Story:** 作为用户，我希望能够配置源语言和目标语言，以便控制翻译的方向。

#### Acceptance Criteria

1. THE Word_Selection_Translate_System SHALL allow users to configure the source language with a default value of "auto"
2. THE Word_Selection_Translate_System SHALL allow users to configure the target language with a default value of "zh" (Chinese)
3. THE Word_Selection_Translate_System SHALL support the following languages: auto, zh, en, ja, ko, fr, de, es, ru, ar, pt, it
4. THE Word_Selection_Translate_System SHALL persist language settings in user configuration
5. THE Word_Selection_Translate_System SHALL display the detected source language in the Floating_Window when "auto" is selected

### Requirement 8: 性能要求

**User Story:** 作为用户，我希望划词翻译响应迅速，以便不影响我的工作流程。

#### Acceptance Criteria

1. WHEN the hotkey is pressed, THE Word_Selection_Translate_System SHALL display the Floating_Window within 200ms
2. THE Word_Selection_Translate_System SHALL complete the clipboard save and restore operation within 600ms
3. WHEN the Translation_Service responds, THE Word_Selection_Translate_System SHALL update the Floating_Window within 100ms
4. THE Floating_Window SHALL render smoothly without blocking the main application
5. THE Word_Selection_Translate_System SHALL handle concurrent translation requests by canceling the previous request

### Requirement 9: 错误处理

**User Story:** 作为用户，我希望系统能够优雅地处理错误，以便了解问题并采取相应措施。

#### Acceptance Criteria

1. WHEN a network error occurs, THE Word_Selection_Translate_System SHALL display a user-friendly error message in the Floating_Window
2. WHEN the Translation_Service is unavailable, THE Word_Selection_Translate_System SHALL display a message indicating the service is unreachable
3. WHEN API rate limits are exceeded, THE Word_Selection_Translate_System SHALL display a message indicating the rate limit and suggest waiting
4. WHEN the selected text is empty or contains only whitespace, THE Word_Selection_Translate_System SHALL display a message indicating no valid text was found
5. IF the clipboard operation fails, THEN THE Word_Selection_Translate_System SHALL log the error and display a message suggesting manual copy-paste
6. THE Word_Selection_Translate_System SHALL log all errors to the application log for debugging purposes

### Requirement 10: 窗口样式

**User Story:** 作为用户，我希望悬浮窗口具有简洁美观的样式，以便提供良好的视觉体验。

#### Acceptance Criteria

1. THE Floating_Window SHALL have a compact size with a maximum width of 400 pixels
2. THE Floating_Window SHALL have rounded corners with a radius of 8 pixels
3. THE Floating_Window SHALL have a subtle shadow to distinguish it from the background
4. THE Floating_Window SHALL support both light and dark themes based on system preferences
5. THE Floating_Window SHALL display the original text and translated text in separate sections
6. THE Floating_Window SHALL use a readable font size of at least 14 pixels
7. THE Floating_Window SHALL have appropriate padding and spacing for comfortable reading
