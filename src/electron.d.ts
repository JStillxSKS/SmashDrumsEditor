export {};

declare global {
  interface Window {
    electronAPI?: {
      isDesktop: true;
      getOutputDir: () => Promise<string>;
      saveFile: (
        relativePath: string,
        data: string,
        encoding?: "utf8" | "base64"
      ) => Promise<{ path: string; displayPath: string }>;
      saveBinaryFile: (
        relativePath: string,
        bytes: Uint8Array
      ) => Promise<{ path: string; displayPath: string }>;
      openOutputDir: () => Promise<string>;
    };
  }
}