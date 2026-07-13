/** Electron adds a filesystem `path` on File objects from native pickers. */
export function fileSystemPath(file: File): string | null {
  const path = (file as File & { path?: string }).path;
  if (typeof path !== "string" || path.length === 0) return null;
  return path;
}

/**
 * True when `absolutePath` looks like an editor export location.
 * Also accepts any custom folder the user picked (ends with /output or
 * contains the project layout). Used only as a soft hint for re-save path.
 */
export function isOutputFolderPath(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("smashdrumseditor/output") ||
    normalized.includes("smash drums editor/smashdrumseditor/output") ||
    // Legacy location (Desktop\Smash Drums Editor\output)
    /smash drums editor\/output(?:\/|$)/.test(normalized) ||
    // Custom folder often named "output"
    /\/output\/[^/]+\.indies$/i.test(normalized) ||
    /\/output$/i.test(normalized.replace(/\/[^/]+\.indies$/i, ""))
  );
}

export function joinOutputPath(outputDir: string, filename: string): string {
  const sep = outputDir.includes("\\") ? "\\" : "/";
  return `${outputDir.replace(/[/\\]+$/, "")}${sep}${filename}`;
}