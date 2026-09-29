/**
 * Parity check: editor MIDI import (src/utils/midiConvert.ts) must produce
 * the same charts as the Python converter (scripts/midi_to_smash.py) when
 * run with --no-align on the same file.
 *
 * Usage: npx tsx scripts/compare-midi-convert.mts <midi...>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { midiFileToPackage } from "../src/utils/midiConvert";

const DIFFS = ["ChartEasy", "ChartNormal", "ChartHard", "ChartExtreme"] as const;

type MetaJson = {
  NameArtist: string;
  NameSong: string;
  SongTiming: Array<{ beat: number; timer: number }>;
  SongPhases: Array<{ beat: number; phase: number; power: number; phaseName: string }>;
  ChartEasy: Array<{ Beat: number; Id: number; Strength: number }>;
  ChartNormal: Array<{ Beat: number; Id: number; Strength: number }>;
  ChartHard: Array<{ Beat: number; Id: number; Strength: number }>;
  ChartExtreme: Array<{ Beat: number; Id: number; Strength: number }>;
};

function compareNotes(name: string, py: MetaJson, ts: MetaJson): string[] {
  const problems: string[] = [];
  for (const key of DIFFS) {
    const a = py[key];
    const b = ts[key];
    if (a.length !== b.length) {
      problems.push(`${name} ${key}: length ${a.length} (py) vs ${b.length} (ts)`);
      continue;
    }
    let firstDiff = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i].Beat !== b[i].Beat || a[i].Id !== b[i].Id || a[i].Strength !== b[i].Strength) {
        firstDiff = i;
        break;
      }
    }
    if (firstDiff >= 0) {
      problems.push(
        `${name} ${key}: first diff at index ${firstDiff}: ` +
          `py(${a[firstDiff].Beat},${a[firstDiff].Id}) ts(${b[firstDiff].Beat},${b[firstDiff].Id})`
      );
    }
  }
  return problems;
}

function compareTiming(py: MetaJson, ts: MetaJson): string[] {
  const problems: string[] = [];
  const a = py.SongTiming;
  const b = ts.SongTiming;
  if (a.length !== b.length) {
    problems.push(`SongTiming: length ${a.length} (py) vs ${b.length} (ts)`);
    return problems;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].beat !== b[i].beat || a[i].timer !== b[i].timer) {
      problems.push(
        `SongTiming[${i}]: py(${a[i].beat},${a[i].timer}) ts(${b[i].beat},${b[i].timer})`
      );
    }
  }
  return problems;
}

function comparePhases(py: MetaJson, ts: MetaJson): string[] {
  const problems: string[] = [];
  const a = py.SongPhases;
  const b = ts.SongPhases;
  if (a.length !== b.length) {
    problems.push(`SongPhases: length ${a.length} (py) vs ${b.length} (ts)`);
    return problems;
  }
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].beat !== b[i].beat ||
      a[i].phase !== b[i].phase ||
      a[i].power !== b[i].power ||
      a[i].phaseName !== b[i].phaseName
    ) {
      problems.push(`SongPhases[${i}]: py(${JSON.stringify(a[i])}) ts(${JSON.stringify(b[i])})`);
    }
  }
  return problems;
}

async function main() {
  const midis = process.argv.slice(2).map((p) => resolve(p));
  if (midis.length === 0) {
    console.error("Usage: npx tsx scripts/compare-midi-convert.mts <midi...>");
    process.exit(2);
  }

  const repoRoot = resolve(import.meta.dirname, "..");
  const pyScript = join(repoRoot, "scripts", "midi_to_smash.py");
  let failures = 0;

  for (const midi of midis) {
    const outDir = mkdtempSync(join(tmpdir(), "midi-parity-"));
    let pyFailed: string | null = null;
    try {
      execFileSync("python", [pyScript, midi, "--out", outDir, "--no-align"], {
        stdio: "pipe",
      });
    } catch (err) {
      const stderr = err instanceof Error ? String((err as { stderr?: Buffer }).stderr ?? "") : "";
      pyFailed = stderr.trim().split("\n").pop() ?? "python failed";
    }

    const bytes = readFileSync(midi);
    const file = new File([bytes], midi.split(/[\\/]/).pop() ?? midi);

    let tsFailed: string | null = null;
    let pkg: Awaited<ReturnType<typeof midiFileToPackage>> | null = null;
    try {
      pkg = await midiFileToPackage(file);
    } catch (err) {
      tsFailed = err instanceof Error ? err.message : String(err);
    }

    // Both reject (e.g. tom-only stems under the velocity floor) = parity.
    if (pyFailed && tsFailed) {
      console.log(`OK   ${file.name}  (both reject: py='${pyFailed}' ts='${tsFailed}')`);
      continue;
    }
    if (pyFailed) {
      failures += 1;
      console.log(`FAIL ${file.name}: python rejected ('${pyFailed}') but TS converted`);
      continue;
    }
    if (tsFailed) {
      failures += 1;
      console.log(`FAIL ${file.name}: TS rejected ('${tsFailed}') but python converted`);
      continue;
    }

    // Python output: <outDir>/<SafeTitle>/meta.json — find the single folder
    const folders = readdirSync(outDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (folders.length !== 1) {
      console.log(`SKIP ${midi}: expected 1 output folder, got ${folders.length}`);
      continue;
    }
    const pyMeta = JSON.parse(
      readFileSync(join(outDir, folders[0].name, "meta.json"), "utf8")
    ) as MetaJson;

    const tsMeta: MetaJson = {
      NameArtist: pkg.meta.NameArtist,
      NameSong: pkg.meta.NameSong,
      SongTiming: pkg.meta.SongTiming,
      SongPhases: pkg.meta.SongPhases,
      ChartEasy: pkg.meta.ChartEasy,
      ChartNormal: pkg.meta.ChartNormal,
      ChartHard: pkg.meta.ChartHard,
      ChartExtreme: pkg.meta.ChartExtreme,
    };

    const problems: string[] = [];
    if (pyMeta.NameArtist !== tsMeta.NameArtist || pyMeta.NameSong !== tsMeta.NameSong) {
      problems.push(
        `names: py(${pyMeta.NameArtist} / ${pyMeta.NameSong}) ts(${tsMeta.NameArtist} / ${tsMeta.NameSong})`
      );
    }
    problems.push(...compareNotes(folders[0].name, pyMeta, tsMeta));
    problems.push(...compareTiming(pyMeta, tsMeta));
    problems.push(...comparePhases(pyMeta, tsMeta));

    if (problems.length === 0) {
      console.log(
        `OK   ${folders[0].name}  Extreme=${tsMeta.ChartExtreme.length} ` +
          `Hard=${tsMeta.ChartHard.length} Normal=${tsMeta.ChartNormal.length} ` +
          `Easy=${tsMeta.ChartEasy.length}  anchors=${tsMeta.SongTiming.length}`
      );
    } else {
      failures += 1;
      console.log(`FAIL ${folders[0].name}`);
      for (const p of problems) console.log(`     ${p}`);
    }
  }

  console.log(failures === 0 ? "\nALL MATCH" : `\n${failures} file(s) mismatched`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
