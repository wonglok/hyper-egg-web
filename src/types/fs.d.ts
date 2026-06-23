export {};

declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    [Symbol.asyncIterator](): AsyncIterator<[string, FileSystemHandle]>;
    queryPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }
}
