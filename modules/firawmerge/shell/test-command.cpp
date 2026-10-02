#include <windows.h>
#include <shobjidl.h>
#include <cstdio>
#include <string>

int wmain(int argc, wchar_t** argv) {
  if (argc > 2) return 2;
  HMODULE library = nullptr;
  HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(initialized)) return 9;
  const CLSID clsid = argc == 2 && wcscmp(argv[1], L"--winmerge") == 0
    ? CLSID{ 0x90340779, 0xf37e, 0x468e, { 0x97, 0x28, 0xa2, 0x59, 0x34, 0x98, 0xed, 0x32 } }
    : CLSID{ 0xffa33935, 0x6a62, 0x4b3f, { 0x8e, 0x17, 0xc8, 0x0b, 0xe9, 0x74, 0xfd, 0x08 } };
  IExplorerCommand* command = nullptr;
  if (argc == 1 || wcscmp(argv[1], L"--winmerge") == 0) {
    HRESULT activation = CoCreateInstance(clsid, nullptr, CLSCTX_ALL, IID_IExplorerCommand,
      reinterpret_cast<void**>(&command));
    if (FAILED(activation)) { wprintf(L"COM activation failed: 0x%08X\n", static_cast<unsigned>(activation)); return 10; }
  } else {
  library = LoadLibraryW(argv[1]);
  if (!library) return 3;
  using FactoryEntry = HRESULT(STDAPICALLTYPE*)(REFCLSID, REFIID, void**);
  auto entry = reinterpret_cast<FactoryEntry>(GetProcAddress(library, "DllGetClassObject"));
  if (!entry) return 4;
  IClassFactory* factory = nullptr;
  HRESULT result = entry(clsid, IID_IClassFactory, reinterpret_cast<void**>(&factory));
  if (FAILED(result)) return 5;
  result = factory->CreateInstance(nullptr, IID_IExplorerCommand, reinterpret_cast<void**>(&command));
  factory->Release();
  if (FAILED(result)) return 6;
  }
  wchar_t* title = nullptr;
  HRESULT result = command->GetTitle(nullptr, &title);
  if (FAILED(result) || !title || (argc == 1 && wcscmp(title, L"FirawMerge") != 0)) return 7;
  wprintf(L"%ls\n", title);
  CoTaskMemFree(title);
  if (argc == 1) {
    wchar_t* icon = nullptr;
    result = command->GetIcon(nullptr, &icon);
    if (FAILED(result) || !icon) return 11;
    std::wstring iconPath(icon);
    CoTaskMemFree(icon);
    const size_t separator = iconPath.rfind(L',');
    if (separator != std::wstring::npos) iconPath.resize(separator);
    if (GetFileAttributesW(iconPath.c_str()) == INVALID_FILE_ATTRIBUTES) return 12;
  }
  EXPCMDSTATE state = ECS_DISABLED;
  result = command->GetState(nullptr, FALSE, &state);
  command->Release();
  if (library) FreeLibrary(library);
  CoUninitialize();
  return SUCCEEDED(result) && state == ECS_ENABLED ? 0 : 8;
}
