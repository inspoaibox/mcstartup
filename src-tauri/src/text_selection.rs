#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiaFailureKind {
    InvalidTarget,
    ComInitialization,
    AutomationInitialization,
    FocusMismatch,
    PatternUnavailable,
    NoSelection,
    ProviderCallFailed,
}

#[derive(Debug, Clone)]
pub struct UiaSelectionError {
    pub kind: UiaFailureKind,
    pub stage: &'static str,
    pub hresult: Option<i32>,
}

impl UiaSelectionError {
    fn new(kind: UiaFailureKind, stage: &'static str) -> Self {
        Self {
            kind,
            stage,
            hresult: None,
        }
    }

    #[cfg(target_os = "windows")]
    fn from_windows(
        kind: UiaFailureKind,
        stage: &'static str,
        error: windows::core::Error,
    ) -> Self {
        Self {
            kind,
            stage,
            hresult: Some(error.code().0),
        }
    }

    pub fn diagnostic(&self) -> String {
        match self.hresult {
            Some(code) => format!("stage={}, HRESULT=0x{:08X}", self.stage, code as u32),
            None => format!("stage={}", self.stage),
        }
    }
}

/// Reads the selected text from the foreground application through UI Automation.
/// This function must run on a worker thread that does not own any windows.
#[cfg(target_os = "windows")]
pub fn get_selected_text_via_uia(target_hwnd: isize) -> Result<String, UiaSelectionError> {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation};

    if target_hwnd == 0 {
        return Err(UiaSelectionError::new(
            UiaFailureKind::InvalidTarget,
            "target-window",
        ));
    }

    let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.map_err(|error| {
        UiaSelectionError::from_windows(
            UiaFailureKind::ComInitialization,
            "com-mta-initialize",
            error,
        )
    })?;

    let result = (|| {
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.map_err(
                |error| {
                    UiaSelectionError::from_windows(
                        UiaFailureKind::AutomationInitialization,
                        "create-uiautomation",
                        error,
                    )
                },
            )?;

        let mut last_error = UiaSelectionError::new(
            UiaFailureKind::PatternUnavailable,
            "text-pattern-unavailable",
        );

        for delay_ms in [0u64, 45, 110] {
            if delay_ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            }

            match unsafe { try_get_selected_text(&automation, target_hwnd) } {
                Ok(text) => return Ok(text),
                Err(error) => last_error = error,
            }
        }

        Err(last_error)
    })();

    let _ = initialized;
    unsafe { CoUninitialize() };
    result
}

#[cfg(target_os = "windows")]
unsafe fn try_get_selected_text(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    target_hwnd: isize,
) -> Result<String, UiaSelectionError> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Accessibility::{
        TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_DocumentControlTypeId,
    };

    let target_pid = window_process_id(target_hwnd)
        .ok_or_else(|| UiaSelectionError::new(UiaFailureKind::InvalidTarget, "target-process"))?;
    let root = automation
        .ElementFromHandle(HWND(target_hwnd))
        .map_err(|error| {
            UiaSelectionError::from_windows(
                UiaFailureKind::ProviderCallFailed,
                "element-from-handle",
                error,
            )
        })?;

    let mut summary = ProbeSummary::default();

    match automation.GetFocusedElement() {
        Ok(focused) => match focused.CurrentProcessId() {
            Ok(process_id) if process_id as u32 == target_pid => {
                if let Some(text) =
                    probe_element_and_parents(automation, focused, target_pid, &mut summary)
                {
                    return Ok(text);
                }
            }
            Ok(_) => {
                summary.focus_mismatch = true;
            }
            Err(error) => summary.record_error(UiaSelectionError::from_windows(
                UiaFailureKind::ProviderCallFailed,
                "focused-element-process",
                error,
            )),
        },
        Err(error) => summary.record_error(UiaSelectionError::from_windows(
            UiaFailureKind::ProviderCallFailed,
            "get-focused-element",
            error,
        )),
    }

    if let Some(text) = summary.probe(&root) {
        return Ok(text);
    }

    let document_condition = automation
        .CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            variant_i32(UIA_DocumentControlTypeId.0 as i32),
        )
        .map_err(|error| {
            UiaSelectionError::from_windows(
                UiaFailureKind::ProviderCallFailed,
                "create-document-condition",
                error,
            )
        })?;

    match root.FindAll(TreeScope_Descendants, &document_condition) {
        Ok(documents) => match documents.Length() {
            Ok(count) => {
                for index in 0..count.min(16) {
                    if let Ok(document) = documents.GetElement(index) {
                        if let Some(text) = summary.probe(&document) {
                            return Ok(text);
                        }
                    }
                }
            }
            Err(error) => summary.record_error(UiaSelectionError::from_windows(
                UiaFailureKind::ProviderCallFailed,
                "document-count",
                error,
            )),
        },
        Err(error) => summary.record_error(UiaSelectionError::from_windows(
            UiaFailureKind::ProviderCallFailed,
            "find-document-elements",
            error,
        )),
    }

    Err(summary.into_error())
}

#[cfg(target_os = "windows")]
unsafe fn probe_element_and_parents(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    focused: windows::Win32::UI::Accessibility::IUIAutomationElement,
    target_pid: u32,
    summary: &mut ProbeSummary,
) -> Option<String> {
    let walker = match automation.ControlViewWalker() {
        Ok(walker) => walker,
        Err(error) => {
            summary.record_error(UiaSelectionError::from_windows(
                UiaFailureKind::ProviderCallFailed,
                "control-view-walker",
                error,
            ));
            return summary.probe(&focused);
        }
    };

    let mut current = focused;
    for _ in 0..20 {
        if let Some(text) = summary.probe(&current) {
            return Some(text);
        }

        let parent = match walker.GetParentElement(&current) {
            Ok(parent) => parent,
            Err(_) => break,
        };
        if parent.CurrentProcessId().ok().map(|pid| pid as u32) != Some(target_pid) {
            break;
        }
        current = parent;
    }

    None
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct ProbeSummary {
    saw_pattern: bool,
    saw_empty_selection: bool,
    focus_mismatch: bool,
    last_error: Option<UiaSelectionError>,
}

#[cfg(target_os = "windows")]
impl ProbeSummary {
    unsafe fn probe(
        &mut self,
        element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    ) -> Option<String> {
        match probe_text_pattern(element) {
            PatternProbe::Selected(text) => Some(text),
            PatternProbe::Empty => {
                self.saw_pattern = true;
                self.saw_empty_selection = true;
                None
            }
            PatternProbe::Unavailable(error) => {
                if self.last_error.is_none() {
                    self.last_error = Some(error);
                }
                None
            }
            PatternProbe::Failed(error) => {
                self.saw_pattern = true;
                self.last_error = Some(error);
                None
            }
        }
    }

    fn record_error(&mut self, error: UiaSelectionError) {
        self.last_error = Some(error);
    }

    fn into_error(self) -> UiaSelectionError {
        if self.saw_empty_selection {
            UiaSelectionError::new(UiaFailureKind::NoSelection, "empty-selection")
        } else if self.saw_pattern {
            self.last_error.unwrap_or_else(|| {
                UiaSelectionError::new(UiaFailureKind::ProviderCallFailed, "text-pattern-selection")
            })
        } else if self.focus_mismatch {
            UiaSelectionError::new(UiaFailureKind::FocusMismatch, "focused-element-mismatch")
        } else {
            self.last_error.unwrap_or_else(|| {
                UiaSelectionError::new(
                    UiaFailureKind::PatternUnavailable,
                    "text-pattern-unavailable",
                )
            })
        }
    }
}

#[cfg(target_os = "windows")]
enum PatternProbe {
    Selected(String),
    Empty,
    Unavailable(UiaSelectionError),
    Failed(UiaSelectionError),
}

#[cfg(target_os = "windows")]
unsafe fn probe_text_pattern(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
) -> PatternProbe {
    use windows::Win32::UI::Accessibility::{IUIAutomationTextPattern, UIA_TextPatternId};

    let pattern = match element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) {
        Ok(pattern) => pattern,
        Err(error) => {
            return PatternProbe::Unavailable(UiaSelectionError::from_windows(
                UiaFailureKind::PatternUnavailable,
                "get-text-pattern",
                error,
            ))
        }
    };

    let ranges = match pattern.GetSelection() {
        Ok(ranges) => ranges,
        Err(error) => {
            return PatternProbe::Failed(UiaSelectionError::from_windows(
                UiaFailureKind::ProviderCallFailed,
                "get-selection-ranges",
                error,
            ))
        }
    };
    let count = match ranges.Length() {
        Ok(count) => count,
        Err(error) => {
            return PatternProbe::Failed(UiaSelectionError::from_windows(
                UiaFailureKind::ProviderCallFailed,
                "selection-range-count",
                error,
            ))
        }
    };

    let mut selected_parts = Vec::new();
    for index in 0..count {
        let range = match ranges.GetElement(index) {
            Ok(range) => range,
            Err(error) => {
                return PatternProbe::Failed(UiaSelectionError::from_windows(
                    UiaFailureKind::ProviderCallFailed,
                    "selection-range",
                    error,
                ))
            }
        };
        let text = match range.GetText(-1) {
            Ok(text) => text.to_string(),
            Err(error) => {
                return PatternProbe::Failed(UiaSelectionError::from_windows(
                    UiaFailureKind::ProviderCallFailed,
                    "selection-range-text",
                    error,
                ))
            }
        };
        if !text.trim().is_empty() {
            selected_parts.push(text);
        }
    }

    if selected_parts.is_empty() {
        PatternProbe::Empty
    } else {
        PatternProbe::Selected(selected_parts.join("\n"))
    }
}

#[cfg(target_os = "windows")]
fn window_process_id(target_hwnd: isize) -> Option<u32> {
    use winapi::shared::windef::HWND;
    use winapi::um::winuser::{GetWindowThreadProcessId, IsWindow};

    let hwnd = target_hwnd as HWND;
    if hwnd.is_null() || unsafe { IsWindow(hwnd) } == 0 {
        return None;
    }

    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
    (process_id != 0).then_some(process_id)
}

#[cfg(target_os = "windows")]
fn variant_i32(value: i32) -> windows::Win32::System::Variant::VARIANT {
    use std::mem::ManuallyDrop;
    use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_I4};

    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                Anonymous: VARIANT_0_0_0 { lVal: value },
                ..Default::default()
            }),
        },
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_selected_text_via_uia(_target_hwnd: isize) -> Result<String, UiaSelectionError> {
    Err(UiaSelectionError::new(
        UiaFailureKind::PatternUnavailable,
        "platform-not-supported",
    ))
}
