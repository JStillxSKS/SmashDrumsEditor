export {};

declare global {
  interface Window {
    electronAPI?: {
      isDesktop: true;
      openExternal: (url: string) => Promise<void>;
      getOutputDir: () => Promise<string>;
      setOutputDir: (dirPath: string) => Promise<string>;
      pickOutputDir: () => Promise<string | null>;
      resetOutputDir: () => Promise<string>;
      saveFile: (
        relativePath: string,
        data: string,
        encoding?: "utf8" | "base64"
      ) => Promise<{ path: string; displayPath: string }>;
      saveBinaryFile: (
        relativePath: string,
        bytes: Uint8Array
      ) => Promise<{ path: string; displayPath: string }>;
      saveBinaryToPath: (
        absolutePath: string,
        bytes: Uint8Array
      ) => Promise<{ path: string; displayPath: string }>;
      backupOutputIfExists: (
        relativePath: string
      ) => Promise<{ backedUp: boolean; path?: string }>;
      readOutputBinary: (relativePath: string) => Promise<number[] | null>;
      listRecoveryFiles: () => Promise<
        { name: string; path: string; mtime: number }[]
      >;
      openOutputDir: () => Promise<string>;
      getFilePath: (file: File) => string;
      pickImportFile: () => Promise<{
        path: string;
        name: string;
        bytes: number[];
      } | null>;
      readSiblingFile: (
        sourceFilePath: string,
        siblingName: string
      ) => Promise<{ name: string; bytes: number[]; mimeType: string } | null>;
    };
  }
}