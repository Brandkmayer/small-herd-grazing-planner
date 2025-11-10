import React, { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Papa from "papaparse";
import * as turf from "@turf/turf";
import { addDays, format, parseISO, isValid, areIntervalsOverlapping } from "date-fns";
import { Download, Calendar, GripVertical, Save, Trash2, Plus, Copy as CopyIcon, Folder, FileText, ChevronRight, ChevronDown } from "lucide-react";

/* ---------------- LocalStorage keys ---------------- */
const LS_KEYS = {
  PREV_PLANNED: "grazingPlanner_prevPlannedADA_byPasture",
  PREV_ACTUAL: "grazingPlanner_prevActualADA_byPasture",
  LAST_PLAN: "grazingPlanner_lastPlan_rows",
  START_DATE: "grazingPlanner_startDate",
  DRAFTS: "grazingPlanner_draftsByYear", // { "2025":[{id,name,ts,startDate,rows}, ...], ... }
};

function loadDict(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function saveDict(key, obj) { localStorage.setItem(key, JSON.stringify(obj || {})); }
function loadRows() { try { return JSON.parse(localStorage.getItem(LS_KEYS.LAST_PLAN) || "null"); } catch { return null; } }
function saveRows(rows) { localStorage.setItem(LS_KEYS.LAST_PLAN, JSON.stringify(rows || [])); }
function loadDrafts() { try { return JSON.parse(localStorage.getItem(LS_KEYS.DRAFTS) || "{}"); } catch { return {}; } }
function saveDrafts(d) { localStorage.setItem(LS_KEYS.DRAFTS, JSON.stringify(d || {})); }

/* ---------------- Helpers ---------------- */
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function computeProposedADA(grazingDays, herdSize, acreage) {
  const g = Math.max(0, toNum(grazingDays));
  const h = Math.max(0, toNum(herdSize));
  const a = Math.max(0.000001, toNum(acreage));
  return +(((g * h) / a).toFixed(2));
}

function toISO(dateStr) {
  if (!dateStr) return "";
  const d = parseISO(dateStr);
  return isValid(d) ? format(d, "yyyy-MM-dd") : "";
}

function addDaysISO(iso, days) {
  const d = parseISO(iso);
  if (!isValid(d)) return "";
  return format(addDays(d, days), "yyyy-MM-dd");
}

function overlapsSummerWindow(startISO, endISO) {
  const s = parseISO(startISO);
  const e = parseISO(endISO);
  if (!isValid(s) || !isValid(e)) return false;
  const sy = s.getFullYear(), ey = e.getFullYear();
  for (let y = sy; y <= ey; y++) {
    const summerStart = parseISO(`${y}-07-15`);
    const summerEnd = parseISO(`${y}-09-15`);
    if (areIntervalsOverlapping({ start: s, end: e }, { start: summerStart, end: summerEnd }, { inclusive: true })) {
      return true;
    }
  }
  return false;
}

const newRow = (overrides = {}) => ({
  id: crypto.randomUUID(),
  pasture: "",
  acreage: 0,
  herdSize: 0,
  prevPlannedADA: null,
  prevActualADA: null,
  estNativeADA: null,
  estPerennialADA: null,
  grazingDays: 0,
  proposedADA: 0,
  startDate: "",
  endDate: "",
  notes: "",
  ...overrides,
});

/* ---------------- Sortable row ---------------- */
function SortableRow({ row, onChange, onDelete, onSelect, isSelected, onDuplicate }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const inSummer = overlapsSummerWindow(row.startDate, row.endDate);
  const tdSummerCls = inSummer ? "bg-emerald-100/70 outline outline-2 outline-emerald-400 rounded-md" : "";
  const inputBase = "w-full rounded border p-1 appearance-none";
  const inputSummerCls = inSummer ? "border-emerald-400 text-emerald-900" : "border-gray-200 text-gray-900";

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b ${isDragging ? "bg-gray-50" : isSelected ? "bg-blue-50" : "bg-white"}`}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => onDuplicate(row.id)}
      title="Click to select; double-click to duplicate"
    >
      <td className="p-2 align-top w-8 text-gray-400">
        <button title="Drag" className="cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
      </td>

      <td className="p-2 align-top min-w-[160px]">
        <input
          className="w-full rounded border border-gray-200 p-1 outline-none focus:ring"
          value={row.pasture}
          onChange={(e) => onChange(row.id, { pasture: e.target.value })}
          placeholder="Pasture"
        />
      </td>

      <td className="p-2 align-top w-28">
        <input className="w-full rounded border border-gray-200 p-1 bg-gray-50 text-gray-700" type="number" step="0.01" value={row.acreage} readOnly title="Acreage is static" />
      </td>

      <td className="p-2 align-top w-40">
        <input className="w-full rounded border border-gray-200 p-1" type="number" step="1" min="0" value={row.herdSize} onChange={(e) => onChange(row.id, { herdSize: toNum(e.target.value) })} />
      </td>

      <td className="p-2 align-top w-32 text-sm text-gray-700">{row.prevPlannedADA ?? "—"}</td>
      <td className="p-2 align-top w-32 text-sm text-gray-700">{row.prevActualADA ?? "—"}</td>
      <td className="p-2 align-top w-40 text-sm text-gray-900 font-medium">{row.estPerennialADA ?? "—"}</td>
      <td className="p-2 align-top w-32 text-sm text-gray-900 font-medium">{row.estNativeADA ?? "—"}</td>
      

      <td className="p-2 align-top w-28">
        <input className="w-full rounded border border-gray-200 p-1" type="number" step="1" min="0" value={row.grazingDays} onChange={(e) => onChange(row.id, { grazingDays: toNum(e.target.value) })} />
      </td>

      <td className="p-2 align-top w-32 font-semibold">{row.proposedADA}</td>

      <td className={`p-2 align-top w-40 ${tdSummerCls}`}>
        <input className={`${inputBase} ${inputSummerCls} bg-white`} type="date" value={row.startDate} readOnly />
      </td>
      <td className={`p-2 align-top w-40 ${tdSummerCls}`}>
        <input className={`${inputBase} ${inputSummerCls} bg-white`} type="date" value={row.endDate} readOnly />
      </td>

      <td className="p-2 align-top min-w-[220px]">
        <input className="w-full rounded border border-gray-200 p-1" value={row.notes} onChange={(e) => onChange(row.id, { notes: e.target.value })} placeholder="Notes" />
      </td>

      <td className="p-2 align-top w-16 text-right space-x-1">
        <button className="rounded p-1 hover:bg-blue-50" title="Copy row" onClick={(e) => { e.stopPropagation(); onDuplicate(row.id); }}>
          <CopyIcon className="h-4 w-4 text-blue-600" />
        </button>
        <button className="rounded p-1 hover:bg-red-50" title="Remove row" onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}>
          <Trash2 className="h-4 w-4 text-red-500" />
        </button>
      </td>
    </tr>
  );
}

/* ---------------- Drafts Sidebar ---------------- */
function DraftsSidebar({ draftsByYear, onSaveDraft, onLoadDraft, onDeleteDraft }) {
  const [openYears, setOpenYears] = useState(() => {
    // open the current year by default
    const y = String(new Date().getFullYear());
    return { [y]: true };
  });

  const toggleYear = (y) => setOpenYears((prev) => ({ ...prev, [y]: !prev[y] }));

  const years = Object.keys(draftsByYear).sort((a, b) => Number(b) - Number(a)); // newest first

  return (
    <div className="w-[320px] shrink-0 self-start rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="p-3 flex items-center justify-between border-b border-gray-100">
        <h3 className="font-semibold text-sm">Drafts</h3>
        <button
          className="rounded bg-indigo-600 text-black text-xs px-2 py-1 hover:bg-indigo-700"
          onClick={onSaveDraft}
          title="Save current rows as a new draft"
        >
          Save Draft
        </button>
      </div>

      <div className="p-2 space-y-1 max-h-[72vh] overflow-auto">
        {years.length === 0 && (
          <div className="text-xs text-gray-500">No drafts yet. Click <b>Save Draft</b> to create one.</div>
        )}

        {years.map((y) => {
          const arr = draftsByYear[y] || [];
          // Draft names based on save order (1..n), regardless of timestamp
          const items = arr.map((d, idx) => ({ ...d, displayName: `Draft ${idx + 1}` }));

          return (
            <div key={y} className="rounded-md border border-gray-200 bg-gray-50/60">
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-gray-100"
                onClick={() => toggleYear(y)}
              >
                {openYears[y] ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                <Folder className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium">{y}</span>
                <span className="ml-auto text-[11px] text-gray-500">{arr.length} draft{arr.length === 1 ? "" : "s"}</span>
              </button>

              {openYears[y] && (
                <ul className="px-2 pb-2 space-y-1">
                  {items.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 rounded bg-white border border-gray-200 px-2 py-1">
                      <FileText className="h-4 w-4 text-gray-500" />
                      <div className="flex-1">
                        <div className="text-xs font-medium">{d.displayName}</div>
                        <div className="text-[10px] text-gray-500">
                          {d.startDate ? `Start ${d.startDate}` : "No season start"} • {new Date(d.ts).toLocaleString()}
                        </div>
                      </div>
                      <button
                        className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
                        onClick={() => onLoadDraft(y, d.id)}
                        title="Load this draft into the table"
                      >
                        Load
                      </button>
                      <button
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => onDeleteDraft(y, d.id)}
                        title="Delete draft"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Static SVG Map ---------------- */
function StaticMap({ rows, featureByPasture, allFeatures, svgRef }) {
  const features = React.useMemo(() => {
    const picked = rows.map(r => featureByPasture[String(r.pasture || '').toLowerCase()]).filter(Boolean);
    return picked.length ? picked : allFeatures;
  }, [rows, featureByPasture, allFeatures]);

  if (!features || !features.length) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-gray-500">
        Upload a GeoJSON to draw a static map.
      </div>
    );
  }

  // Web Mercator-like projection
  const R = 6378137;
  const lonLatToMerc = ([lng, lat]) => {
    const x = R * (lng * Math.PI / 180);
    const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
    return [x, y];
  };

  const fc = turf.featureCollection(features);
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(fc);
  const [minX, minY] = lonLatToMerc([minLng, minLat]);
  const [maxX, maxY] = lonLatToMerc([maxLng, maxLat]);

  const padFrac = 0.06;
  const dx = maxX - minX, dy = maxY - minY;
  const x0 = minX - dx * padFrac, x1 = maxX + dx * padFrac;
  const y0 = minY - dy * padFrac, y1 = maxY + dy * padFrac;

  const W = 1000, H = 700;
  const sx = W / (x1 - x0), sy = H / (y1 - y0);
  const s = Math.min(sx, sy);
  const ox = (W - s * (x1 - x0)) / 2;
  const oy = (H - s * (y1 - y0)) / 2;

  const projectXY = ([lng, lat]) => {
    const [mx, my] = lonLatToMerc([lng, lat]);
    const x = ox + (mx - x0) * s;
    const y = oy + (y1 - my) * s; // flip y
    return [x, y];
  };

  function pathFromPolygonCoords(rings) {
    let d = "";
    for (const ring of rings) {
      if (!ring || !ring.length) continue;
      const [xStart, yStart] = projectXY(ring[0]);
      d += `M ${xStart} ${yStart}`;
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = projectXY(ring[i]);
        d += ` L ${x} ${y}`;
      }
      d += " Z";
    }
    return d;
  }

  // build polygon paths
  const polyPaths = [];
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      polyPaths.push(pathFromPolygonCoords(g.coordinates));
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) polyPaths.push(pathFromPolygonCoords(poly));
    }
  }

  // label anchors from centerOfMass for route order
  const activeRows = rows.filter(r => (Number(r?.grazingDays) || 0) > 0);

  const routeAnchors = activeRows.map(r => {
    const f = featureByPasture[String(r.pasture || '').toLowerCase()];
    if (!f) return null;
    const cm = turf.centerOfMass(f);
    const [lng, lat] = cm.geometry.coordinates;
    const [x, y] = projectXY([lng, lat]);
    return { name: r.pasture, x, y };
  }).filter(Boolean);

  const routeNameSet = new Set(routeAnchors.map(a => (a.name || '').toLowerCase()));

  const nonRouteLabels = [];
  for (const f of features) {
    const nk = Object.keys(f.properties || {}).find(k => /^(pasture|name|unit|past|paddock)$/i.test(k));
    const label = nk ? String(f.properties[nk]) : "";
    if (!label || routeNameSet.has(label.toLowerCase())) continue;
    try {
      const cm = turf.centerOfMass(f);
      const [lng, lat] = cm.geometry.coordinates;
      const [x, y] = projectXY([lng, lat]);
      nonRouteLabels.push({ text: label, x, y });
    } catch {}
  }

  // arrow segments
  const SHIFT_FROM_TEXT = 10;
  const shiftTowards = ([x1, y1], [x2, y2], d = 0) => {
    const dx2 = x2 - x1, dy2 = y2 - y1;
    const L = Math.hypot(dx2, dy2) || 1;
    return [x1 + (dx2 / L) * d, y1 + (dy2 / L) * d];
  };

  const segments = [];
  for (let i = 0; i < routeAnchors.length - 1; i++) {
    const a = routeAnchors[i];
    const b = routeAnchors[i + 1];
    const [sx, sy] = shiftTowards([a.x, a.y], [b.x, b.y], SHIFT_FROM_TEXT);
    const d = `M ${sx} ${sy} L ${b.x} ${b.y}`;

    const mx = (sx + b.x) / 2;
    const my = (sy + b.y) / 2;
    const dx3 = b.x - sx, dy3 = b.y - sy;
    const L = Math.hypot(dx3, dy3) || 1;
    const nx = -dy3 / L, ny = dx3 / L;
    const LABEL_OFFSET = 0;
    const nxp = mx + nx * LABEL_OFFSET, nyp = my + ny * LABEL_OFFSET;

    segments.push({ key: `seg-${i}`, d, num: i + 1, labelPos: [nxp, nyp] });
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto" markerUnits="strokeWidth">
          <polygon points="0 0, 6 2, 0 4" fill="#2563eb" />
        </marker>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#f8fafc" />

      {polyPaths.map((d, i) => (
        <path key={`poly-${i}`} d={d} fill="#93c5fd" fillOpacity="0.18" stroke="#475569" strokeWidth="1.25" />
      ))}

      {/* arrows behind labels */}
      {segments.map(seg => (
        <path key={seg.key} d={seg.d} fill="none" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrowhead)" />
      ))}

      {/* move numbers */}
      {segments.map(seg => {
        const [x, y] = seg.labelPos;
        return (
          <g key={`${seg.key}-num`}>
            <circle cx={x} cy={y} r="10" fill="#ffffff" stroke="#0f172a" strokeWidth="1.5" />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill="#0f172a" style={{ fontFamily: "system-ui, sans-serif" }}>
              {seg.num}
            </text>
          </g>
        );
      })}

      {/* route labels */}
      {routeAnchors.map((a, i) => (
        <g key={`route-label-${i}`}>
          <text x={a.x} y={a.y} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" stroke="#fff" strokeWidth="3" paintOrder="stroke" style={{ fontFamily: "system-ui, sans-serif" }}>
            {a.name}
          </text>
          <text x={a.x} y={a.y} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill="#0f172a" style={{ fontFamily: "system-ui, sans-serif" }}>
            {a.name}
          </text>
        </g>
      ))}

      {/* non-route labels */}
      {nonRouteLabels.map((lb, i) => (
        <g key={`nonroute-${i}`}>
          <text x={lb.x} y={lb.y} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" stroke="#fff" strokeWidth="3" paintOrder="stroke" style={{ fontFamily: "system-ui, sans-serif" }}>
            {lb.text}
          </text>
          <text x={lb.x} y={lb.y} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fill="#0f172a" style={{ fontFamily: "system-ui, sans-serif" }}>
            {lb.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ---------------- Map export (SVG/PNG) ---------------- */
function StaticMapExportButtons({ svgRef }) {
  function downloadSVG() {
    const svg = svgRef.current;
    if (!svg) return alert("Map not ready.");
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "grazing_route.svg"; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPNG(scale = 2) {
    const svg = svgRef.current;
    if (!svg) return alert("Map not ready.");
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);

    const vb = (svg.getAttribute("viewBox") || "0 0 1000 700").split(/\s+/).map(Number);
    const vw = vb[2], vh = vb[3];

    const img = new Image();
    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const dl = URL.createObjectURL(pngBlob);
        const a = document.createElement("a");
        a.href = dl; a.download = "grazing_route.png"; a.click();
        URL.revokeObjectURL(dl);
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert("PNG render failed."); };
    img.src = url;
  }

  return (
    <>
      <button className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50" onClick={downloadSVG} title="Download vector map">
        Export SVG
      </button>
      <button className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50" onClick={() => downloadPNG(2)} title="Download PNG (2×)">
        Export PNG
      </button>
    </>
  );
}

/* ---------------- Main ---------------- */
export default function GrazingPlanner() {
  const [startDate, setStartDate] = useState(() => localStorage.getItem(LS_KEYS.START_DATE) || "");
  const prevPlannedDictRef = useRef(loadDict(LS_KEYS.PREV_PLANNED));
  const prevActualDictRef = useRef(loadDict(LS_KEYS.PREV_ACTUAL));
  const [selectedRowId, setSelectedRowId] = useState(null);

  // drafts
  const [draftsByYear, setDraftsByYear] = useState(loadDrafts);

  // map/static svg state
  const [featureByPasture, setFeatureByPasture] = useState({});
  const [allFeatures, setAllFeatures] = useState([]);
  const geoRef = useRef(null);
  const svgRef = useRef(null);

  const defaultRows = [
    newRow({ pasture: "UA-E", acreage: 156, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "UA-G", acreage: 441, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "UA-F", acreage: 336, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "1", acreage: 782, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "8", acreage: 815, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "11C", acreage: 214, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "FS Ranger", acreage: 487, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "4", acreage: 670, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "11B", acreage: 212, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "UA-A", acreage: 549, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "UA-C", acreage: 365, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "UA-H", acreage: 453, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "UA-D", acreage: 357, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "140 Trap", acreage: 41, herdSize: 110, grazingDays: 0 }),
    newRow({ pasture: "HQ", acreage: 25, herdSize: 110, grazingDays: 0 }),
  ];

  const [rows, setRows] = useState(() => {
    const loaded = loadRows();
    const base = loaded && Array.isArray(loaded) && loaded.length ? loaded : defaultRows;
    return seedPreviousSeasonAndEstimates(base, prevPlannedDictRef.current, prevActualDictRef.current);
  });

  function seedPreviousSeasonAndEstimates(list, prevPlanned, prevActual) {
    return list.map(r => ({
      ...r,
      prevPlannedADA: prevPlanned?.[r.pasture] ?? r.prevPlannedADA,
      prevActualADA: prevActual?.[r.pasture] ?? r.prevActualADA,
    }));
  }

  // persist rows & start
  useEffect(() => { saveRows(rows); }, [rows]);
  useEffect(() => { localStorage.setItem(LS_KEYS.START_DATE, startDate || ""); }, [startDate]);

  // recompute dependent fields
  useEffect(() => {
    const recomputed = recompute(rows, startDate);
    const changed = JSON.stringify(rows) !== JSON.stringify(recomputed);
    if (changed) setRows(recomputed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, JSON.stringify(rows.map(r => ({ id: r.id, pasture: r.pasture, acreage: r.acreage, herdSize: r.herdSize, grazingDays: r.grazingDays })))]);

  function recompute(list, planStart) {
    const out = list.map(r => ({ ...r }));
    for (const r of out) r.proposedADA = computeProposedADA(r.grazingDays, r.herdSize, r.acreage);
    let currentStart = toISO(planStart);
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      if (!currentStart) { r.startDate = ""; r.endDate = ""; continue; }
      const days = Math.max(0, toNum(r.grazingDays));
      r.startDate = currentStart;
      r.endDate = days > 0 ? addDaysISO(currentStart, days - 1) : currentStart;
      currentStart = addDaysISO(r.endDate, 1);
    }
    return out;
  }

  // row handlers
  function updateRow(id, patch) { setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r))); }
  function deleteRow(id) { setRows(prev => prev.filter(r => r.id !== id)); }
  function duplicateRow(id) {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      if (idx < 0) return prev;
      const copy = { ...prev[idx], id: crypto.randomUUID() };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      return next;
    });
  }
  function addEmptyRow() { setRows(prev => [...prev, newRow({ pasture: "New Pasture", acreage: 0, herdSize: 0, grazingDays: 0 })]); }
  function copySelectedRow() { if (selectedRowId) duplicateRow(selectedRowId); }
  function clearTable() { if (confirm("Clear all rows and reset to a blank table?")) { setRows([newRow()]); setSelectedRowId(null); } }
  function restoreDefaults() {
    if (!confirm("Reset rows to the built-in default pasture list?")) return;
    const seeded = seedPreviousSeasonAndEstimates(defaultRows, prevPlannedDictRef.current, prevActualDictRef.current);
    saveRows(seeded); setRows(seeded); setSelectedRowId(null);
  }
  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex(r => r.id === active.id);
    const newIndex = rows.findIndex(r => r.id === over.id);
    setRows(arrayMove(rows, oldIndex, newIndex));
  }

  // CSV import
  const fileRef = useRef(null);
  function handleFileUpload(kind) { if (!fileRef.current) return; fileRef.current.dataset.kind = kind; fileRef.current.click(); }
  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const kind = e.target.dataset.kind || "estimates";
    Papa.parse(file, {
      header: true, dynamicTyping: true, skipEmptyLines: true,
      complete: ({ data }) => {
        if (!Array.isArray(data)) return;
        if (kind === "estimates") applyEstimatesFromCSV(data);
        else applyPreviousSeasonFromCSV(data);
      },
      error: (err) => alert("CSV parse error: " + err?.message),
    });
    e.target.value = "";
  }

  function applyEstimatesFromCSV(rowsFromCSV) {
    const norm = (s) => (s || "").toString().trim().toLowerCase();
    const first = rowsFromCSV[0] || {};
    const keys = Object.keys(first || {});
    const pastureKey = keys.find(k => /pasture|paddock|unit/.test(norm(k))) || "Pasture";
    const nativeKey = keys.find(k => /(est.*native.*ada)|(native.*ada)/.test(norm(k))) || "EstNativeADA";
    const perenKey = keys.find(k => /(est.*per.*ada)|(perennial.*ada)/.test(norm(k))) || "EstPerennialADA";

    const lookup = new Map();
    for (const row of rowsFromCSV) {
      const p = String(row[pastureKey] ?? "").trim();
      if (!p) continue;
      const n = row[nativeKey] ?? null;
      const g = row[perenKey] ?? null;
      lookup.set(p.toLowerCase(), { estNativeADA: n, estPerennialADA: g });
    }
    setRows(prev => prev.map(r => {
      const hit = lookup.get(String(r.pasture).toLowerCase());
      return hit ? { ...r, ...hit } : r;
    }));
  }

  function applyPreviousSeasonFromCSV(rowsFromCSV) {
    const norm = (s) => (s || "").toString().trim().toLowerCase();
    const first = rowsFromCSV[0] || {};
    const keys = Object.keys(first || {});
    const pastureKey = keys.find(k => /pasture|paddock|unit/.test(norm(k))) || "Pasture";
    const plannedKey = keys.find(k => /(prev.*plan.*ada)|(plan.*ada)/.test(norm(k))) || "PrevPlannedADA";
    const actualKey = keys.find(k => /(prev.*act.*ada)|(actual.*ada)/.test(norm(k))) || "PrevActualADA";

    const plannedDict = { ...prevPlannedDictRef.current };
    const actualDict = { ...prevActualDictRef.current };

    for (const row of rowsFromCSV) {
      const p = String(row[pastureKey] ?? "").trim();
      if (!p) continue;
      const planned = row[plannedKey] ?? null;
      const actual = row[actualKey] ?? null;
      if (planned != null) plannedDict[p] = planned;
      if (actual != null) actualDict[p] = actual;
    }

    prevPlannedDictRef.current = plannedDict;
    prevActualDictRef.current = actualDict;
    saveDict(LS_KEYS.PREV_PLANNED, plannedDict);
    saveDict(LS_KEYS.PREV_ACTUAL, actualDict);
    setRows(prev => seedPreviousSeasonAndEstimates(prev, plannedDict, actualDict));
  }

  function saveCurrentAsPrevPlanned() {
    const dict = { ...prevPlannedDictRef.current };
    for (const r of rows) if (r.pasture) dict[r.pasture] = r.proposedADA;
    prevPlannedDictRef.current = dict;
    saveDict(LS_KEYS.PREV_PLANNED, dict);
    setRows(prev => seedPreviousSeasonAndEstimates(prev, dict, prevActualDictRef.current));
  }

  function exportCSV() {
    const data = rows.map(r => ({
      Pasture: r.pasture,
      Acreage: r.acreage,
      HerdSize: r.herdSize,
      PrevPlannedADA: r.prevPlannedADA,
      PrevActualADA: r.prevActualADA,
      EstNativeADA: r.estNativeADA,
      EstPerennialADA: r.estPerennialADA,
      GrazingDays: r.grazingDays,
      ProposedADA: r.proposedADA,
      ProjectedStart: r.startDate,
      ProjectedEnd: r.endDate,
      Notes: r.notes,
    }));
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `grazing_plan_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // totals
  const totals = useMemo(() => {
    const totalADA = rows.reduce((s, r) => s + toNum(r.proposedADA), 0);
    const totalDays = rows.reduce((s, r) => s + Math.max(0, toNum(r.grazingDays)), 0);
    return { totalADA: +totalADA.toFixed(2), totalDays };
  }, [rows]);

  // geojson upload
  function handleGeoUploadClick() { geoRef.current?.click(); }
  function onGeoFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const gj = JSON.parse(reader.result);
        if (gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
          alert('Please upload a GeoJSON FeatureCollection.');
          return;
        }
        const pickKey = (props) => {
          const ks = Object.keys(props || {}).map(k => [k, k.toLowerCase()]);
          const hit = ks.find(([, lk]) => /^(pasture|name|unit|past|paddock)$/.test(lk));
          return hit ? hit[0] : null;
        };
        const byName = {};
        const feats = [];
        for (const f of gj.features) {
          if (!f || !f.properties) continue;
          const key = pickKey(f.properties);
          const raw = key ? String(f.properties[key] ?? '').trim() : '';
          if (!raw) continue;
          const name = raw.toLowerCase();
          byName[name] = f;
          feats.push(f);
        }
        setFeatureByPasture(byName);
        setAllFeatures(feats);
      } catch (err) {
        alert('GeoJSON parse error: ' + err?.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // drafts actions
  function handleSaveDraft() {
    const y = (startDate && /^\d{4}/.test(startDate)) ? startDate.slice(0, 4) : String(new Date().getFullYear());
    const copyRows = rows.map(r => ({ ...r }));
    const draft = { id: crypto.randomUUID(), name: "", ts: Date.now(), startDate, rows: copyRows };
    setDraftsByYear((prev) => {
      const next = { ...prev };
      const arr = Array.isArray(next[y]) ? [...next[y]] : [];
      arr.push(draft); // order = save order
      next[y] = arr;
      saveDrafts(next);
      return next;
    });
  }

  function handleLoadDraft(year, id) {
    const arr = draftsByYear[year] || [];
    const d = arr.find(x => x.id === id);
    if (!d) return;
    if (!confirm(`Load ${year} ${d.name || ""} into the table? This will replace current rows and season start.`)) return;
    setRows(d.rows.map(r => ({ ...r, id: crypto.randomUUID() }))); // new IDs for DnD
    setStartDate(d.startDate || "");
    setSelectedRowId(null);
  }

  function handleDeleteDraft(year, id) {
    if (!confirm("Delete this draft?")) return;
    setDraftsByYear((prev) => {
      const next = { ...prev };
      next[year] = (next[year] || []).filter(d => d.id !== id);
      if (next[year].length === 0) delete next[year];
      saveDrafts(next);
      return next;
    });
  }

  /* ---------------- Render ---------------- */
  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Small Herd Grazing Planner</h1>
            <p className="text-sm text-gray-600">Reorder rows to change sequence; start/end dates update automatically. Save drafts per year on the right.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <Calendar className="h-4 w-4" />
              <span className="text-sm">Season Start</span>
              <input className="rounded border border-gray-200 p-1" type="date" value={startDate} onChange={(e) => setStartDate(toISO(e.target.value))} />
            </label>

            <button className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50" onClick={() => handleFileUpload("estimates")} title="CSV: Pasture, EstNativeADA, EstPerennialADA">
              Import Estimates CSV
            </button>
            <button className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50" onClick={() => handleFileUpload("previous")} title="CSV: Pasture, PrevPlannedADA, PrevActualADA">
              Import Previous Season CSV
            </button>

            <button onClick={saveCurrentAsPrevPlanned} className="rounded-lg bg-indigo-600 px-3 py-2 text-black shadow hover:bg-indigo-700 text-sm">
              <Save className="mr-1 inline h-4 w-4" /> Save plan → Prev Planned
            </button>
            <button onClick={exportCSV} className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50">
              <Download className="mr-1 inline h-4 w-4" /> Export CSV
            </button>
          </div>
        </header>

        {/* hidden inputs */}
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} />
        <input ref={geoRef} type="file" accept=".geojson,application/geo+json,application/json" className="hidden" onChange={onGeoFileChange} />

        {/* === MAIN: table + drafts (side-by-side), map below === */}
        <div className="mt-6">
          {/* TABLE (left) + DRAFTS (right) */}
          <div className="flex gap-4 overflow-x-auto">
            {/* TABLE COLUMN */}
            <div className="flex-1 min-w-[900px]">
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <div className="overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                  <table className="min-w-[1200px] w-full text-base">
                    <thead className="sticky top-0 bg-gray-50 text-left text-sm uppercase text-gray-500 tracking-wider z-10">
                      <tr>
                        <th className="p-2 w-8"></th>
                        <th className="p-2">Pasture</th>
                        <th className="p-2">Acreage</th>
                        <th className="p-2 w-40">Herd Size</th>
                        <th className="p-2">Prev. Planned ADA</th>
                        <th className="p-2">Prev. Actual ADA</th>
                        <th className="p-2">Est. Perennial ADA (this yr)</th>                        
                        <th className="p-2">Est. Native ADA (this yr)</th>
                        <th className="p-2">Projected Grazing Days</th>
                        <th className="p-2">Proposed ADA (this yr)</th>
                        <th className="p-2">Projected Start</th>
                        <th className="p-2">Projected End</th>
                        <th className="p-2">Notes</th>
                        <th className="p-2 w-16"></th>
                      </tr>
                    </thead>

                    <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
                      <tbody>
                        {rows.map((r) => (
                          <SortableRow
                            key={r.id}
                            row={r}
                            onChange={updateRow}
                            onDelete={deleteRow}
                            onDuplicate={duplicateRow}
                            onSelect={setSelectedRowId}
                            isSelected={selectedRowId === r.id}
                          />
                        ))}
                      </tbody>
                    </SortableContext>

                    <tfoot>
                      <tr className="bg-gray-50 text-xs text-gray-700">
                        <td colSpan={8}></td>
                        <td className="p-2 font-semibold">Total: {totals.totalDays}</td>
                        <td colSpan={5}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </DndContext>
            </div>

            {/* DRAFTS COLUMN (fixed width, no wrap) */}
            <div className="w-80 shrink-0 self-start">
              <DraftsSidebar
                draftsByYear={draftsByYear}
                onSaveDraft={handleSaveDraft}
                onLoadDraft={handleLoadDraft}
                onDeleteDraft={handleDeleteDraft}
              />
            </div>
          </div>

          {/* MAP (full width below both) */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="p-2 flex flex-wrap items-center gap-2 border-b border-gray-100">
              <button
                className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50"
                onClick={handleGeoUploadClick}
              >
                Import Pasture GeoJSON
              </button>

              <div className="mx-2 h-5 w-px bg-gray-200" />

              <button className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50" onClick={addEmptyRow}>
                <Plus className="mr-1 inline h-4 w-4" /> Add Row
              </button>
              <button
                className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50"
                onClick={copySelectedRow}
                disabled={!selectedRowId}
                title="Click a row, then copy"
              >
                <CopyIcon className="mr-1 inline h-4 w-4" /> Copy Selected Row
              </button>
              <button className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50" onClick={clearTable}>
                <Trash2 className="mr-1 inline h-4 w-4" /> Clear Table
              </button>
              <button className="rounded-lg bg-white px-3 py-2 shadow border border-gray-200 text-sm hover:bg-gray-50" onClick={restoreDefaults}>
                Restore Default Pastures
              </button>

              <div className="ml-auto text-xs text-gray-600">
                Total Projected Days: <span className="font-semibold">{totals.totalDays}</span>
              </div>
            </div>

            <div className="h-[72vh] min-h-[420px] w-full bg-slate-50">
              <StaticMap
                rows={rows}
                featureByPasture={featureByPasture}
                allFeatures={allFeatures}
                svgRef={svgRef}
              />
            </div>

            <div className="p-2 flex items-center gap-2 border-t border-gray-100">
              <StaticMapExportButtons svgRef={svgRef} />
              <span className="text-xs text-gray-600">
                {allFeatures.length
                  ? `Loaded ${allFeatures.length} polygons • Unmatched rows: ${rows.filter(
                      r => !featureByPasture[String(r.pasture || '')?.toLowerCase()]
                    ).length}`
                  : `Upload a GeoJSON to draw polygons & route.`}
              </span>
            </div>
          </div>
        </div>


        <footer className="mt-8 text-xs text-gray-500">
          <ul className="list-disc ml-5 space-y-1">
            <li><b>Proposed ADA</b> = (Projected Grazing Days × Herd Size) ÷ Acreage.</li>
            <li>Reordering rows recomputes sequential <b>Projected Start</b> and <b>Projected End</b>.</li>
            <li>Use <b>Save plan → Prev Planned</b> to store this plan's ADA as next season's <b>Previous Season Planned ADA</b>.</li>
            <li>Import estimated ADA (Native/Perennial) via CSV matched on pasture name.</li>
          </ul>
        </footer>
      </div>
    </div>
  );
}
