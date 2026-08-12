#![allow(non_snake_case)]

use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::copy_nonoverlapping;
use std::sync::atomic::{AtomicU32, Ordering};

use windows::core::{implement, ComInterface, Error, GUID, HRESULT, HSTRING, PCWSTR, PSTR};
use windows::Win32::Foundation::{
    CloseHandle, BOOL, CLASS_E_NOAGGREGATION, E_NOINTERFACE, E_POINTER, S_FALSE, S_OK,
};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl, IDataObject};
use windows::Win32::System::Registry::HKEY;
use windows::Win32::UI::Shell::{
    IContextMenu, IContextMenu_Impl, IShellExtInit, IShellExtInit_Impl, ShellExecuteExW,
    CMF_DEFAULTONLY, CMINVOKECOMMANDINFO, GCS_VERBW, SHELLEXECUTEINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, DestroyMenu, InsertMenuW, HMENU, MF_BYPOSITION, MF_POPUP,
    MF_STRING, SW_SHOWNORMAL,
};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const CLSID: GUID = GUID::from_u128(0xb9e1f7d5_6d89_4a1a_9e8b_6e4d3d03d5f4);
const CLSID_REG_PATH: &str = r"Software\Classes\CLSID\{B9E1F7D5-6D89-4A1A-9E8B-6E4D3D03D5F4}";
const PATH_VALUE: &str = "McStartUPPath";
const NEW_COMMAND: usize = 0;
const MANAGE_COMMAND: usize = 1;
static OBJECT_COUNT: AtomicU32 = AtomicU32::new(0);

#[implement(IShellExtInit, IContextMenu)]
struct DesktopBoxContextMenu;

impl DesktopBoxContextMenu {
    fn create() -> Self {
        OBJECT_COUNT.fetch_add(1, Ordering::SeqCst);
        Self
    }
}

impl Drop for DesktopBoxContextMenu {
    fn drop(&mut self) {
        OBJECT_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl IShellExtInit_Impl for DesktopBoxContextMenu {
    fn Initialize(
        &self,
        _pidlfolder: *const windows::Win32::UI::Shell::Common::ITEMIDLIST,
        _pdtobj: Option<&IDataObject>,
        _hkeyprogid: HKEY,
    ) -> windows::core::Result<()> {
        Ok(())
    }
}

impl IContextMenu_Impl for DesktopBoxContextMenu {
    fn QueryContextMenu(
        &self,
        hmenu: HMENU,
        indexmenu: u32,
        idcmdfirst: u32,
        idcmdlast: u32,
        uflags: u32,
    ) -> windows::core::Result<()> {
        if (uflags & CMF_DEFAULTONLY) != 0 {
            return Ok(());
        }
        if hmenu.0 == 0 || idcmdlast.saturating_sub(idcmdfirst) < MANAGE_COMMAND as u32 {
            return Err(Error::from(E_POINTER));
        }

        let popup = unsafe { CreatePopupMenu()? };
        let new_label = wide("新建桌面 Box");
        let manage_label = wide("管理桌面 Box");
        let parent_label = wide("McStartUP 桌面 Box");

        let append_result = unsafe {
            AppendMenuW(
                popup,
                MF_STRING,
                idcmdfirst as usize,
                PCWSTR(new_label.as_ptr()),
            )
            .and_then(|_| {
                AppendMenuW(
                    popup,
                    MF_STRING,
                    (idcmdfirst + 1) as usize,
                    PCWSTR(manage_label.as_ptr()),
                )
            })
            .and_then(|_| {
                InsertMenuW(
                    hmenu,
                    indexmenu,
                    MF_BYPOSITION | MF_POPUP | MF_STRING,
                    popup.0 as usize,
                    PCWSTR(parent_label.as_ptr()),
                )
            })
        };

        if let Err(error) = append_result {
            unsafe {
                let _ = DestroyMenu(popup);
            }
            return Err(error);
        }

        // QueryContextMenu returns the number of command IDs consumed in the
        // low word of a successful HRESULT (S_OK alone is not sufficient).
        Err(Error::from(HRESULT((MANAGE_COMMAND as i32) + 1)))
    }

    fn InvokeCommand(&self, pici: *const CMINVOKECOMMANDINFO) -> windows::core::Result<()> {
        if pici.is_null() {
            return Err(Error::from(E_POINTER));
        }

        let command_id = unsafe { (*pici).lpVerb.0 as usize };
        let argument = match command_id {
            NEW_COMMAND => "--desktop-box-new",
            MANAGE_COMMAND => "--desktop-box-manage",
            _ => return Err(Error::from(E_NOINTERFACE)),
        };
        let executable = configured_executable()?;
        let file = wide(&executable);
        let params = wide(argument);
        let verb = wide("open");
        let show = unsafe { (*pici).nShow }.max(1);
        let hwnd = unsafe { (*pici).hwnd };
        let mut execute_info = SHELLEXECUTEINFOW {
            cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: 64, // SEE_MASK_NOCLOSEPROCESS
            hwnd,
            lpVerb: PCWSTR(verb.as_ptr()),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            nShow: if show == 0 { SW_SHOWNORMAL.0 } else { show },
            ..Default::default()
        };

        unsafe {
            ShellExecuteExW(&mut execute_info)?;
            if execute_info.hProcess.0 != 0 {
                let _ = CloseHandle(execute_info.hProcess);
            }
        }
        Ok(())
    }

    fn GetCommandString(
        &self,
        idcmd: usize,
        utype: u32,
        _preserved: *const u32,
        pszname: PSTR,
        cchmax: u32,
    ) -> windows::core::Result<()> {
        if pszname.0.is_null() || cchmax == 0 {
            return Err(Error::from(E_POINTER));
        }
        let text = match idcmd {
            NEW_COMMAND if (utype & GCS_VERBW) != 0 => "new",
            MANAGE_COMMAND if (utype & GCS_VERBW) != 0 => "manage",
            NEW_COMMAND => "新建桌面 Box",
            MANAGE_COMMAND => "管理桌面 Box",
            _ => return Err(Error::from(E_NOINTERFACE)),
        };
        let mut bytes = text.as_bytes().to_vec();
        bytes.push(0);
        let copy_len = bytes.len().min(cchmax as usize);
        unsafe {
            copy_nonoverlapping(bytes.as_ptr(), pszname.0, copy_len);
            *pszname.0.add(copy_len.saturating_sub(1)) = 0;
        }
        Ok(())
    }
}

#[implement(IClassFactory)]
struct DesktopBoxClassFactory;

impl DesktopBoxClassFactory {
    fn create() -> Self {
        OBJECT_COUNT.fetch_add(1, Ordering::SeqCst);
        Self
    }
}

impl Drop for DesktopBoxClassFactory {
    fn drop(&mut self) {
        OBJECT_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl IClassFactory_Impl for DesktopBoxClassFactory {
    fn CreateInstance(
        &self,
        punkouter: Option<&windows::core::IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if ppvobject.is_null() {
            return Err(Error::from(E_POINTER));
        }
        unsafe {
            *ppvobject = std::ptr::null_mut();
        }
        if punkouter.is_some() {
            return Err(Error::from(CLASS_E_NOAGGREGATION));
        }
        let object: IContextMenu = DesktopBoxContextMenu::create().into();
        let result = unsafe { object.as_unknown().query(riid, ppvobject) };
        drop(object);
        result.ok()
    }

    fn LockServer(&self, flock: BOOL) -> windows::core::Result<()> {
        if flock.as_bool() {
            OBJECT_COUNT.fetch_add(1, Ordering::SeqCst);
        } else {
            OBJECT_COUNT.fetch_sub(1, Ordering::SeqCst);
        }
        Ok(())
    }
}

#[no_mangle]
pub extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        return E_POINTER;
    }
    unsafe {
        *ppv = std::ptr::null_mut();
        if *rclsid != CLSID {
            return HRESULT(-2147221231); // CLASS_E_CLASSNOTAVAILABLE
        }
    }
    let factory: IClassFactory = DesktopBoxClassFactory::create().into();
    let result = unsafe { factory.as_unknown().query(riid, ppv) };
    drop(factory);
    result.into()
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if OBJECT_COUNT.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

fn configured_executable() -> windows::core::Result<String> {
    let root = RegKey::predef(HKEY_CURRENT_USER);
    let key = root
        .open_subkey(CLSID_REG_PATH)
        .map_err(|_| missing_config("McStartUP shell extension registration is missing"))?;
    key.get_value(PATH_VALUE)
        .map_err(|_| missing_config("McStartUP executable path is missing"))
}

fn missing_config(message: &str) -> Error {
    Error::new(HRESULT::from_win32(2), HSTRING::from(message))
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
