import type { ChartNote, MetaJson, SongPhase, TimingAnchor } from "../types/meta";
import { DEFAULT_TIME_SIGNATURE, normalizeTimeSignature } from "./resolution";

const META_FIELD_ORDER: (keyof MetaJson)[] = [
  "NameArtist",
  "NameSong",
  "NameCharter",
  "FilePath",
  "SongOffsetSeconds",
  "TimeSignature",
  "SongTiming",
  "SongPhases",
  "ChartEasy",
  "ChartNormal",
  "ChartHard",
  "ChartExtreme",
];

function jsonString(value: string): string {
  return JSON.stringify(value);
}

/** Chart notes & song phases: `12.0` for whole beats. */
function formatDecimalBeat(beat: number): string {
  if (Number.isInteger(beat)) return `${beat}.0`;
  return String(beat);
}

/** SongTiming beats stay as integers when whole. */
function formatTimingBeat(beat: number): string {
  if (Number.isInteger(beat)) return String(beat);
  return String(beat);
}

function formatTimer(timer: number): string {
  if (timer === 0) return "0.0";
  return String(timer);
}

function formatOffset(seconds: number): string {
  if (Number.isInteger(seconds)) return `${seconds}.0`;
  return String(seconds);
}

function serializeTimingAnchor(anchor: TimingAnchor): string {
  const lines = [
    "        {",
    `            "beat": ${formatTimingBeat(anchor.beat)},`,
    `            "timer": ${formatTimer(anchor.timer)}${anchor.anchored ? "," : ""}`,
  ];
  if (anchor.anchored) {
    lines.push(`            "anchored": true`);
  }
  lines.push("        }");
  return lines.join("\n");
}

function serializeSongPhase(phase: SongPhase): string {
  return [
    "        {",
    `            "beat": ${formatDecimalBeat(phase.beat)},`,
    `            "phase": ${phase.phase},`,
    `            "power": ${phase.power},`,
    `            "phaseName": ${jsonString(phase.phaseName)}`,
    "        }",
  ].join("\n");
}

function serializeChartNote(note: ChartNote): string {
  return [
    "        {",
    `            "Beat": ${formatDecimalBeat(note.Beat)},`,
    `            "Strength": ${note.Strength},`,
    `            "Id": ${note.Id}`,
    "        }",
  ].join("\n");
}

function serializeObjectArray<T>(items: T[], serializeItem: (item: T) => string): string {
  if (items.length === 0) return "[]";
  return `[\n${items.map(serializeItem).join(",\n")}\n    ]`;
}

function serializeTimeSignature(meta: MetaJson): string {
  const ts = normalizeTimeSignature(meta.TimeSignature ?? DEFAULT_TIME_SIGNATURE);
  return `{\n        "numerator": ${ts.numerator},\n        "denominator": ${ts.denominator}\n    }`;
}

/** Serialize meta.json matching Stacked Actors / official Indies layout. */
export function serializeMetaJson(meta: MetaJson): string {
  const lines: string[] = ["{"];

  META_FIELD_ORDER.forEach((key, index) => {
    const trailing = index < META_FIELD_ORDER.length - 1 ? "," : "";

    switch (key) {
      case "NameArtist":
      case "NameSong":
      case "NameCharter":
      case "FilePath":
        lines.push(`    "${key}": ${jsonString(meta[key])}${trailing}`);
        break;
      case "SongOffsetSeconds":
        lines.push(`    "${key}": ${formatOffset(meta.SongOffsetSeconds)}${trailing}`);
        break;
      case "TimeSignature":
        lines.push(`    "${key}": ${serializeTimeSignature(meta)}${trailing}`);
        break;
      case "SongTiming":
        lines.push(
          `    "${key}": ${serializeObjectArray(meta.SongTiming, serializeTimingAnchor)}${trailing}`
        );
        break;
      case "SongPhases":
        lines.push(
          `    "${key}": ${serializeObjectArray(meta.SongPhases, serializeSongPhase)}${trailing}`
        );
        break;
      case "ChartEasy":
        lines.push(
          `    "${key}": ${serializeObjectArray(meta.ChartEasy, serializeChartNote)}${trailing}`
        );
        break;
      case "ChartNormal":
        lines.push(
          `    "${key}": ${serializeObjectArray(meta.ChartNormal, serializeChartNote)}${trailing}`
        );
        break;
      case "ChartHard":
        lines.push(
          `    "${key}": ${serializeObjectArray(meta.ChartHard, serializeChartNote)}${trailing}`
        );
        break;
      case "ChartExtreme":
        lines.push(
          `    "${key}": ${serializeObjectArray(meta.ChartExtreme, serializeChartNote)}${trailing}`
        );
        break;
      default:
        break;
    }
  });

  lines.push("}");
  return `${lines.join("\n")}\n`;
}
