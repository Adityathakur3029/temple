/**
 * The aarti timings painted on the today board, in Hindi above English (spec 02 § Gate, spec 07
 * § Strings). The board model is blank; this text is drawn in code (spec 11 § Slots). Times come
 * from AARTI_TIMES_IST so the board can never disagree with the schedule.
 */
import { CanvasTexture, Mesh, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import { AARTI_TIMES_IST, TODAY_BOARD } from "@sannidhi/protocol";
import { t } from "../i18n/t";

/** The painted panel's face: 1.44 × 0.73 m, 1.06 … 1.79 m up, 0.065 m in front of the centre. */
const PANEL_W = 1.36;
const PANEL_H = 0.66;
const PANEL_Y = (1.06 + 1.79) / 2;
const FRONT = 0.068;

const FONT = '"Noto Sans Devanagari", "Nirmala UI", "Mangal", "Noto Sans", sans-serif';
const INK = "#3a2412";
const INK_SOFT = "#6b3d1a";

/** "06:00" → 6, "19:00" → 7 (12-hour clock, as written on the board). */
export function boardHour(hhmm: string): number {
  const h = Number(hhmm.slice(0, 2));
  return h % 12 === 0 ? 12 : h % 12;
}

/** The board's six lines: a title and two timings per language. */
export function boardLines(): { title: string; rows: [string, string][] }[] {
  const [morning, evening] = AARTI_TIMES_IST;
  return (["hi", "en"] as const).map((lang) => ({
    title: t("board.title", undefined, lang),
    rows: [
      [
        t("aarti.morning", undefined, lang),
        t("board.time_morning", { time: boardHour(morning) }, lang),
      ],
      [
        t("aarti.evening", undefined, lang),
        t("board.time_evening", { time: boardHour(evening) }, lang),
      ],
    ],
  }));
}

/** The text plane, or null without a canvas (unit tests). */
export function buildBoardText(): Mesh | null {
  if (typeof document === "undefined") return null;
  const w = 1024;
  const h = Math.round((w * PANEL_H) / PANEL_W);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return null;

  g.clearRect(0, 0, w, h);
  g.textBaseline = "middle";
  const blocks = boardLines();
  const blockH = h / 2;
  blocks.forEach((block, i) => {
    const top = i * blockH;
    g.fillStyle = INK_SOFT;
    g.textAlign = "center";
    g.font = `600 ${Math.round(h * 0.1)}px ${FONT}`;
    g.fillText(block.title, w / 2, top + blockH * 0.2);
    g.fillStyle = INK;
    g.font = `500 ${Math.round(h * 0.088)}px ${FONT}`;
    block.rows.forEach(([name, time], r) => {
      const y = top + blockH * (0.52 + r * 0.29);
      g.textAlign = "left";
      g.fillText(name, w * 0.07, y);
      g.textAlign = "right";
      g.fillText(time, w * 0.93, y);
    });
  });
  // A thin rule between the Hindi and the English.
  g.fillStyle = INK_SOFT;
  g.globalAlpha = 0.5;
  g.fillRect(w * 0.2, blockH - 1.5, w * 0.6, 3);
  g.globalAlpha = 1;

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const mesh = new Mesh(
    new PlaneGeometry(PANEL_W, PANEL_H),
    new MeshLambertMaterial({ map, transparent: true, depthWrite: false }),
  );
  mesh.name = "today-board-text";
  // The plane faces +z; turned by the board's yaw it faces (sin yaw, cos yaw), like the board.
  mesh.rotation.y = TODAY_BOARD.yaw;
  mesh.position.set(
    TODAY_BOARD.x + Math.sin(TODAY_BOARD.yaw) * FRONT,
    PANEL_Y,
    TODAY_BOARD.z + Math.cos(TODAY_BOARD.yaw) * FRONT,
  );
  return mesh;
}
