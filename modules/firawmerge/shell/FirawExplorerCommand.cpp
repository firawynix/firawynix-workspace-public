#include <windows.h>
#include <shobjidl.h>
#include <cstring>
#include <new>
#include <string>
#include <vector>

namespace {
HINSTANCE moduleHandle = nullptr;
const CLSID commandClsid = { 0xffa33935, 0x6a62, 0x4b3f, { 0x8e, 0x17, 0xc8, 0x0b, 0xe9, 0x74, 0xfd, 0x08 } };

HRESULT copyForShell(const std::wstring& value, PWSTR* result) {
  if (!result) return E_POINTER;
  *result = static_cast<PWSTR>(CoTaskMemAlloc((value.size() + 1) * sizeof(wchar_t)));
  if (!*result) return E_OUTOFMEMORY;
  memcpy(*result, value.c_str(), (value.size() + 1) * sizeof(wchar_t));
  return S_OK;
}

std::wstring installDirectory() {
  wchar_t buffer[MAX_PATH] = {};
  DWORD length = GetModuleFileNameW(moduleHandle, buffer, MAX_PATH);
  if (!length || length >= MAX_PATH) return L"";
  std::wstring value(buffer, length);
  size_t slash = value.find_last_of(L"\\/");
  return slash == std::wstring::npos ? L"" : value.substr(0, slash + 1);
}

std::wstring applicationPath() {
  wchar_t buffer[32768] = {};
  DWORD bytes = sizeof(buffer);
  if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Firawynix\\FirawMerge", L"AppPath",
      RRF_RT_REG_SZ, nullptr, buffer, &bytes) == ERROR_SUCCESS && buffer[0]) return buffer;
  return installDirectory() + L"FirawMerge.exe";
}

std::wstring quoted(const std::wstring& value) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (wchar_t character : value) {
    if (character == L'\\') { ++slashes; continue; }
    if (character == L'"') {
      result.append(slashes * 2 + 1, L'\\');
      result.push_back(character);
    } else {
      result.append(slashes, L'\\');
      result.push_back(character);
    }
    slashes = 0;
  }
  result.append(slashes * 2, L'\\');
  result.push_back(L'"');
  return result;
}

class ExplorerCommand final : public IExplorerCommand {
  LONG references = 1;
public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** output) override {
    if (!output) return E_POINTER;
    *output = nullptr;
    if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, IID_IExplorerCommand)) {
      *output = static_cast<IExplorerCommand*>(this); AddRef(); return S_OK;
    }
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG left = InterlockedDecrement(&references);
    if (!left) delete this;
    return left;
  }
  HRESULT STDMETHODCALLTYPE GetTitle(IShellItemArray*, LPWSTR* title) override { return copyForShell(L"FirawMerge", title); }
  HRESULT STDMETHODCALLTYPE GetIcon(IShellItemArray*, LPWSTR* icon) override {
    return copyForShell(applicationPath() + L",0", icon);
  }
  HRESULT STDMETHODCALLTYPE GetToolTip(IShellItemArray*, LPWSTR* tooltip) override {
    return copyForShell(L"Abrir no FirawMerge para comparar arquivos ou pastas", tooltip);
  }
  HRESULT STDMETHODCALLTYPE GetCanonicalName(GUID* name) override {
    if (!name) return E_POINTER;
    *name = commandClsid; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetState(IShellItemArray*, BOOL, EXPCMDSTATE* state) override {
    if (!state) return E_POINTER;
    *state = ECS_ENABLED; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE Invoke(IShellItemArray* selection, IBindCtx*) override {
    if (!selection) return E_INVALIDARG;
    DWORD count = 0;
    HRESULT result = selection->GetCount(&count);
    if (FAILED(result) || count == 0) return E_INVALIDARG;
    std::vector<std::wstring> paths;
    for (DWORD i = 0; i < count && paths.size() < 3; ++i) {
      IShellItem* item = nullptr;
      if (FAILED(selection->GetItemAt(i, &item))) continue;
      PWSTR value = nullptr;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &value)) && value) {
        paths.emplace_back(value);
        CoTaskMemFree(value);
      }
      item->Release();
    }
    if (paths.empty()) return E_INVALIDARG;
    const std::wstring executable = applicationPath();
    if (GetFileAttributesW(executable.c_str()) == INVALID_FILE_ATTRIBUTES) return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
    std::wstring commandLine = quoted(executable);
    for (const auto& item : paths) commandLine += L" " + quoted(item);
    STARTUPINFOW startup = {}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION process = {};
    if (!CreateProcessW(executable.c_str(), commandLine.data(), nullptr, nullptr, FALSE,
      CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) return HRESULT_FROM_WIN32(GetLastError());
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE GetFlags(EXPCMDFLAGS* flags) override {
    if (!flags) return E_POINTER;
    *flags = ECF_DEFAULT; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE EnumSubCommands(IEnumExplorerCommand** commands) override {
    if (!commands) return E_POINTER;
    *commands = nullptr; return E_NOTIMPL;
  }
};

class CommandFactory final : public IClassFactory {
  LONG references = 1;
public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** output) override {
    if (!output) return E_POINTER;
    *output = nullptr;
    if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, IID_IClassFactory)) {
      *output = static_cast<IClassFactory*>(this); AddRef(); return S_OK;
    }
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG left = InterlockedDecrement(&references);
    if (!left) delete this;
    return left;
  }
  HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID iid, void** output) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    auto* command = new (std::nothrow) ExplorerCommand();
    if (!command) return E_OUTOFMEMORY;
    HRESULT result = command->QueryInterface(iid, output);
    command->Release();
    return result;
  }
  HRESULT STDMETHODCALLTYPE LockServer(BOOL) override { return S_OK; }
};
}

extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) { moduleHandle = instance; DisableThreadLibraryCalls(instance); }
  return TRUE;
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID iid, LPVOID* output) {
  if (!IsEqualCLSID(clsid, commandClsid)) return CLASS_E_CLASSNOTAVAILABLE;
  auto* factory = new (std::nothrow) CommandFactory();
  if (!factory) return E_OUTOFMEMORY;
  HRESULT result = factory->QueryInterface(iid, output);
  factory->Release();
  return result;
}

STDAPI DllCanUnloadNow() { return S_FALSE; }
