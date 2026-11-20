/* Vice City Sunset Cover Studio — cover engine and editor.
   One canvas renderer draws both the live preview and the exported PNG,
   so what you see is exactly what you share. No network, no libraries:
   every pixel is drawn by the functions below from system fonts and
   photos loaded on the user's own machine. */

'use strict';

/* ------------------------------------------------------------------ */
/* Colour grades: five poster palettes, each with its own sky, sun,   */
/* caption ink and panel tint.                                        */
/* ------------------------------------------------------------------ */

const GRADES = {
  sunset: {
    label: 'Sunset',
    sky: ['#ff9a3d', '#ff5e62', '#8a2f7d'],
    sun: '#ffd76a',
    sunCore: '#fff3b0',
    ink: '#ffffff',
    accent: '#ffcf5c',
    band: '#1c0b2e',
    tint: 'rgba(255, 94, 98, 0.10)',
    silhouette: '#241031',
  },
  neon: {
    label: 'Neon Night',
    sky: ['#0b1035', '#3b0f66', '#ff2e88'],
    sun: '#ff7ad9',
    sunCore: '#ffe3f6',
    ink: '#eafcff',
    accent: '#39e6ff',
    band: '#0d0524',
    tint: 'rgba(57, 230, 255, 0.10)',
    silhouette: '#0a0618',
  },
  pastel: {
    label: 'Pastel Day',
    sky: ['#ffe3ec', '#ffd166', '#7fd8ff'],
    sun: '#fff3b0',
    sunCore: '#ffffff',
    ink: '#33241f',
    accent: '#ff8fa3',
    band: '#5c2a4d',
    tint: 'rgba(255, 143, 163, 0.08)',
    silhouette: '#4a2b52',
  },
  heat: {
    label: 'Vice Heat',
    sky: ['#ff6a00', '#d7263d', '#3d0c02'],
    sun: '#ffe66d',
    sunCore: '#fffbe0',
    ink: '#fff6e8',
    accent: '#ffb703',
    band: '#2a0602',
    tint: 'rgba(255, 106, 0, 0.12)',
    silhouette: '#1d0501',
  },
  gold: {
    label: 'Gold Rush',
    sky: ['#1a0f00', '#7a4a00', '#ffc300'],
    sun: '#fff1a8',
    sunCore: '#ffffff',
    ink: '#fff8dc',
    accent: '#ffd60a',
    band: '#241503',
    tint: 'rgba(255, 195, 0, 0.10)',
    silhouette: '#120a00',
  },
};

const GRADE_ORDER = ['sunset', 'neon', 'pastel', 'heat', 'gold'];

/* ------------------------------------------------------------------ */
/* Layouts: how the poster area is split into photo panels. Each      */
/* layout lists its panels as fractions of the poster area.           */
/* ------------------------------------------------------------------ */

const LAYOUTS = {
  hero: { label: 'Hero + 3', count: 4 },
  grid: { label: 'Grid 2x2', count: 4 },
  strip: { label: 'Film strip', count: 3 },
  full: { label: 'Full bleed', count: 1 },
};

const LAYOUT_ORDER = ['hero', 'grid', 'strip', 'full'];

/* Slight collage tilt per panel, in degrees, for the printed-poster feel. */
const PANEL_TILT = [-1.1, 0.9, -0.7, 1.2];

const EXPORT_SIZES = {
  square: { w: 1080, h: 1080, label: 'Square 1080x1080' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 1080x1350' },
  wide: { w: 1920, h: 1080, label: 'Wide 1920x1080' },
};

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

function blankPanel() {
  return { img: null, name: '', zoom: 1, ox: 0, oy: 0, fit: false };
}

const state = {
  layout: 'hero',
  grade: 'sunset',
  title: 'SUNSET HEIST',
  tagline: 'A VICE CITY STORY',
  titleSize: 1,
  titlePlace: 'bottom',
  letter: 'block',
  size: 'square',
  seal: 'VICE CITY',
  billing: 'A NEON PICTURES PRODUCTION',
  showSeal: true,
  showBilling: true,
  showDots: true,
  panels: [blankPanel(), blankPanel(), blankPanel(), blankPanel()],
  selected: 0,
  library: [], // { img, name } photos loaded this session
};

/* Last panel rectangles drawn on the preview canvas (canvas pixels),
   kept for click / drag hit-testing. */
let lastPanels = [];
let lastPreviewSize = { w: 1080, h: 1080 };

/* ------------------------------------------------------------------ */
/* Small utilities                                                    */
/* ------------------------------------------------------------------ */

/* Deterministic pseudo-random numbers, so the skyline and the grain
   are identical in the preview and in every export. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image: ' + src));
    img.src = src;
  });
}

function gradeIndex() {
  return GRADE_ORDER.indexOf(state.grade);
}

function layoutIndex() {
  return LAYOUT_ORDER.indexOf(state.layout);
}

function panelCount() {
  return LAYOUTS[state.layout].count;
}

/* ------------------------------------------------------------------ */
/* Poster geometry: where the panels sit for a given canvas size.     */
/* ------------------------------------------------------------------ */

function posterArea(W, H) {
  if (state.titlePlace === 'top') {
    return { x: W * 0.035, y: H * 0.205, w: W * 0.93, h: H * 0.75 };
  }
  /* Leave a band of sky at the top so the sun shows above the panels. */
  return { x: W * 0.035, y: H * 0.17, w: W * 0.93, h: H * 0.62 };
}

function panelRects(W, H) {
  const area = posterArea(W, H);
  const gap = Math.round(Math.min(W, H) * 0.014);
  const rects = [];
  if (state.layout === 'hero') {
    const heroW = area.w * 0.6;
    const sideX = area.x + heroW + gap;
    const sideW = area.w - heroW - gap;
    const sideH = (area.h - gap * 2) / 3;
    rects.push({ x: area.x, y: area.y, w: heroW, h: area.h });
    for (let i = 0; i < 3; i++) {
      rects.push({ x: sideX, y: area.y + i * (sideH + gap), w: sideW, h: sideH });
    }
  } else if (state.layout === 'grid') {
    const cw = (area.w - gap) / 2;
    const ch = (area.h - gap) / 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        rects.push({ x: area.x + c * (cw + gap), y: area.y + r * (ch + gap), w: cw, h: ch });
      }
    }
  } else if (state.layout === 'strip') {
    const sw = (area.w - gap * 2) / 3;
    for (let i = 0; i < 3; i++) {
      rects.push({ x: area.x + i * (sw + gap), y: area.y, w: sw, h: area.h });
    }
  } else {
    rects.push({ x: area.x, y: area.y, w: area.w, h: area.h });
  }
  return rects;
}

/* ------------------------------------------------------------------ */
/* Scene drawing: sky, sun, skyline, palms.                          */
/* ------------------------------------------------------------------ */

function drawSky(ctx, W, H, grade) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, grade.sky[0]);
  sky.addColorStop(0.55, grade.sky[1]);
  sky.addColorStop(1, grade.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
}

function drawSun(ctx, W, H, grade) {
  /* The sun sits in the sky band above the panels, its lower half tucked
     behind their top edges, so it reads as setting behind the poster. */
  const cx = W * 0.5;
  const cy = H * 0.095;
  const r = Math.min(W, H) * 0.115;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const glow = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  glow.addColorStop(0, grade.sunCore);
  glow.addColorStop(0.7, grade.sun);
  glow.addColorStop(1, grade.sky[1]);
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  /* Slats cut across the lower half of the disc, growing thicker. */
  ctx.fillStyle = grade.sky[1];
  let y = cy + r * 0.05;
  let thick = Math.max(2, r * 0.03);
  while (y < cy + r) {
    ctx.fillRect(cx - r, y, r * 2, thick);
    y += thick + r * 0.11;
    thick *= 1.5;
  }
  ctx.restore();
  /* Soft halo around the disc. */
  const halo = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 2.1);
  halo.addColorStop(0, grade.sun + '55');
  halo.addColorStop(1, grade.sun + '00');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - r * 2.1, cy - r * 2.1, r * 4.2, r * 4.2);
}

function drawSkyline(ctx, W, H, grade, seed) {
  const rnd = mulberry32(seed);
  const horizon = H * 0.56;
  ctx.fillStyle = grade.silhouette;
  ctx.globalAlpha = 0.85;
  let x = -W * 0.02;
  while (x < W * 1.02) {
    const bw = W * (0.03 + rnd() * 0.05);
    const bh = H * (0.05 + rnd() * 0.13);
    ctx.fillRect(x, horizon - bh, bw, bh);
    /* A lit window or two on some towers. */
    if (rnd() > 0.45) {
      ctx.fillStyle = grade.accent;
      ctx.globalAlpha = 0.9;
      const wx = x + bw * (0.2 + rnd() * 0.5);
      const wy = horizon - bh + bh * (0.15 + rnd() * 0.5);
      ctx.fillRect(wx, wy, Math.max(2, W * 0.006), Math.max(2, H * 0.008));
      ctx.fillStyle = grade.silhouette;
      ctx.globalAlpha = 0.85;
    }
    x += bw + W * 0.004;
  }
  ctx.globalAlpha = 1;
  /* Ground haze band along the horizon. */
  const haze = ctx.createLinearGradient(0, horizon - H * 0.02, 0, horizon + H * 0.04);
  haze.addColorStop(0, grade.sky[1] + '00');
  haze.addColorStop(0.5, grade.sky[1] + '66');
  haze.addColorStop(1, grade.sky[1] + '00');
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - H * 0.02, W, H * 0.06);
}

/* One palm silhouette: a leaning trunk and seven drooping fronds. */
function drawPalm(ctx, baseX, baseY, height, lean, color) {
  const topX = baseX + lean * height;
  const topY = baseY - height;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  /* Trunk, thicker at the base, with a slight S-curve. */
  ctx.lineWidth = Math.max(4, height * 0.045);
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.quadraticCurveTo(baseX + lean * height * 0.3, baseY - height * 0.6, topX, topY);
  ctx.stroke();
  /* Fronds: filled blades fanning from the crown, arcing up and then
     drooping down, so the silhouette reads as leaves, not lines. */
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.12 + (i / 8) * 0.76);
    const len = height * (0.38 + (i % 3) * 0.05);
    const tipX = topX + Math.cos(a) * len;
    const tipY = topY + Math.sin(a) * len + len * 0.38;
    const midX = topX + (tipX - topX) * 0.5;
    const midY = topY - len * 0.3;
    /* Blade width, perpendicular to the frond's direction. */
    const dx = tipX - topX;
    const dy = tipY - topY;
    const dLen = Math.hypot(dx, dy) || 1;
    const px = (-dy / dLen) * len * 0.07;
    const py = (dx / dLen) * len * 0.07;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX + px, midY + py, tipX, tipY);
    ctx.quadraticCurveTo(midX - px, midY - py, topX, topY);
    ctx.closePath();
    ctx.fill();
  }
  /* A small cluster of coconuts under the crown. */
  ctx.beginPath();
  ctx.arc(topX - height * 0.02, topY + height * 0.03, height * 0.022, 0, Math.PI * 2);
  ctx.arc(topX + height * 0.025, topY + height * 0.035, height * 0.02, 0, Math.PI * 2);
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* Panels: photos, borders, empty placeholders.                       */
/* ------------------------------------------------------------------ */

function drawPhotoInPanel(ctx, rect, panel, grade) {
  const img = panel.img;
  if (!img || !img.naturalWidth) {
    /* Empty panel: tinted placeholder with a prompt. */
    ctx.fillStyle = grade.band;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = grade.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, rect.w * 0.008);
    ctx.setLineDash([Math.max(6, rect.w * 0.04), Math.max(6, rect.w * 0.03)]);
    ctx.strokeRect(rect.x + rect.w * 0.06, rect.y + rect.h * 0.06, rect.w * 0.88, rect.h * 0.88);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = grade.ink;
    ctx.globalAlpha = 0.85;
    ctx.font = '700 ' + Math.round(Math.min(rect.w, rect.h) * 0.09) + 'px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DROP A PHOTO', rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.globalAlpha = 1;
    return;
  }
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const base = panel.fit
    ? Math.min(rect.w / iw, rect.h / ih)
    : Math.max(rect.w / iw, rect.h / ih);
  const scale = base * panel.zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = rect.x + (rect.w - dw) / 2 + panel.ox * rect.w;
  const dy = rect.y + (rect.h - dh) / 2 + panel.oy * rect.h;
  if (panel.fit) {
    ctx.fillStyle = grade.band;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  /* Warm grade tint so the panels sit in the same poster world. */
  ctx.fillStyle = grade.tint;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function drawPanels(ctx, W, H, grade) {
  const rects = panelRects(W, H);
  const count = panelCount();
  const corner = Math.round(Math.min(W, H) * 0.012);
  for (let i = 0; i < count; i++) {
    const rect = rects[i];
    const panel = state.panels[i];
    const tilt = (PANEL_TILT[i] * Math.PI) / 180;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.translate(-cx, -cy);
    /* Soft drop shadow under the panel. */
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = Math.round(Math.min(W, H) * 0.02);
    ctx.shadowOffsetY = Math.round(Math.min(W, H) * 0.008);
    ctx.fillStyle = '#000';
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, corner);
    ctx.fill();
    ctx.restore();
    /* Clip to the panel and draw the photo. */
    ctx.save();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, corner);
    ctx.clip();
    drawPhotoInPanel(ctx, rect, panel, grade);
    ctx.restore();
    /* White poster border, thicker on the selected panel. */
    ctx.lineWidth = i === state.selected ? Math.max(4, W * 0.007) : Math.max(3, W * 0.004);
    ctx.strokeStyle = i === state.selected ? grade.accent : '#ffffff';
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, corner);
    ctx.stroke();
    ctx.restore();
  }
  return rects;
}

/* ------------------------------------------------------------------ */
/* Lettering: title, tagline, halftone dots, seal, billing block.     */
/* ------------------------------------------------------------------ */

/* The title scales with the poster's shorter side, so a wide 1920x1080
   cover keeps its lettering inside the title band instead of spilling
   into the tagline and the billing block. */
function titleFontPx(W, H) {
  return Math.round(Math.min(W * 0.088, H * 0.105) * state.titleSize);
}

function drawTitleBlock(ctx, W, H, grade) {
  const px = titleFontPx(W, H);
  const zoneTop = state.titlePlace === 'top' ? H * 0.02 : H * 0.805;
  const zoneH = H * 0.155;
  /* Legibility wash behind the lettering. */
  const wash = ctx.createLinearGradient(0, zoneTop, 0, zoneTop + zoneH);
  wash.addColorStop(0, 'rgba(10, 5, 20, 0)');
  wash.addColorStop(0.35, 'rgba(10, 5, 20, 0.5)');
  wash.addColorStop(1, 'rgba(10, 5, 20, 0.5)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, zoneTop, W, zoneH);

  const title = (state.title || 'UNTITLED').toUpperCase();
  let size = px;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const setTitleFont = (s) => {
    if (state.letter === 'neon') return '900 ' + s + 'px "Trebuchet MS", "Segoe UI", sans-serif';
    if (state.letter === 'slab') return 'italic 900 ' + s + 'px Georgia, "Times New Roman", serif';
    return '900 ' + s + 'px "Arial Black", Arial, sans-serif';
  };
  /* Shrink the title until it fits the poster width. */
  ctx.font = setTitleFont(size);
  try { ctx.letterSpacing = '2px'; } catch (e) { /* older canvas: ignore */ }
  while (size > Math.round(W * 0.03) && ctx.measureText(title).width > W * 0.94) {
    size = Math.round(size * 0.92);
    ctx.font = setTitleFont(size);
  }
  /* The title block is laid out from the actual font size, so the
     tagline and the dot row keep clear of the billing block in every
     post size, wide ones included. */
  const titleY = zoneTop + size * 0.45;

  if (state.letter === 'neon') {
    /* Neon script: dark band, glowing letters. */
    const bandH = size * 1.5;
    ctx.fillStyle = grade.band;
    roundRectPath(ctx, W * 0.03, titleY - bandH / 2, W * 0.94, bandH, bandH / 2);
    ctx.fill();
    ctx.fillStyle = grade.accent;
    ctx.shadowColor = grade.accent;
    ctx.shadowBlur = size * 0.45;
    ctx.fillText(title, W / 2, titleY);
    ctx.shadowBlur = 0;
  } else if (state.letter === 'slab') {
    ctx.fillStyle = '#fff3d6';
    ctx.strokeStyle = '#7a2f00';
    ctx.lineWidth = Math.max(2, size * 0.03);
    ctx.lineJoin = 'round';
    ctx.strokeText(title, W / 2, titleY);
    ctx.fillText(title, W / 2, titleY);
  } else {
    ctx.fillStyle = grade.ink;
    ctx.strokeStyle = '#1a0f2e';
    ctx.lineWidth = Math.max(2, size * 0.07);
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowOffsetX = size * 0.04;
    ctx.shadowOffsetY = size * 0.05;
    ctx.shadowBlur = 0;
    ctx.strokeText(title, W / 2, titleY);
    ctx.fillText(title, W / 2, titleY);
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  /* Tagline, letterspaced small caps under the title. */
  const tag = (state.tagline || '').toUpperCase();
  if (tag) {
    const tagPx = Math.round(size * 0.24);
    ctx.font = '700 ' + tagPx + 'px "Trebuchet MS", sans-serif';
    try { ctx.letterSpacing = Math.max(2, tagPx * 0.35) + 'px'; } catch (e) { /* ignore */ }
    ctx.fillStyle = grade.accent;
    ctx.fillText(tag, W / 2, titleY + size * 0.55);
  }
  try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }

  /* Halftone dot row under the tagline. */
  if (state.showDots) {
    const dots = 19;
    const dotR = Math.max(2, size * 0.028);
    const span = W * 0.42;
    const dotY = titleY + size * 0.78;
    ctx.fillStyle = grade.accent;
    for (let i = 0; i < dots; i++) {
      const x = W / 2 - span / 2 + (span * i) / (dots - 1);
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7));
      ctx.beginPath();
      ctx.arc(x, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* Circular seal badge with the seal text set along its top arc. */
function drawSeal(ctx, W, H, grade) {
  if (!state.showSeal) return;
  const area = posterArea(W, H);
  const r = Math.min(W, H) * 0.052;
  const cx = W * 0.895;
  const cy = area.y + area.h - r * 0.35;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#fff3d6';
  ctx.strokeStyle = '#a4133c';
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.stroke();
  /* Text along the top arc, in a tighter fan so the end letters stay upright. */
  const word = (state.seal || 'VICE CITY').toUpperCase();
  const fontPx = Math.max(8, Math.round(r * 0.22));
  ctx.font = '900 ' + fontPx + 'px "Arial Black", Arial, sans-serif';
  ctx.fillStyle = '#a4133c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spread = Math.PI * 0.5;
  for (let i = 0; i < word.length; i++) {
    const a = -Math.PI / 2 + (word.length === 1 ? 0 : spread * (i / (word.length - 1) - 0.5));
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -r * 0.66);
    ctx.fillText(word[i], 0, 0);
    ctx.restore();
  }
  /* Star in the middle, city mark below it, kept clear of each other. */
  ctx.font = '900 ' + Math.round(r * 0.38) + 'px "Arial Black", Arial, sans-serif';
  ctx.fillText('★', 0, -r * 0.14);
  ctx.font = '700 ' + Math.round(r * 0.14) + 'px "Trebuchet MS", sans-serif';
  ctx.fillText('EST. 2026', 0, r * 0.55);
  ctx.restore();
}

function drawBilling(ctx, W, H, grade) {
  if (!state.showBilling) return;
  const line = (state.billing || '').toUpperCase();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = grade.ink;
  ctx.globalAlpha = 0.92;
  const px = Math.max(10, Math.round(W * 0.014));
  ctx.font = '700 ' + px + 'px "Trebuchet MS", sans-serif';
  try { ctx.letterSpacing = Math.max(1, px * 0.25) + 'px'; } catch (e) { /* ignore */ }
  ctx.fillText(line, W / 2, H * 0.975);
  ctx.globalAlpha = 0.65;
  ctx.font = '400 ' + Math.round(px * 0.8) + 'px "Trebuchet MS", sans-serif';
  ctx.fillText('VICE CITY SUNSET COVER STUDIO  •  MADE OFFLINE', W / 2, H * 0.992);
  ctx.globalAlpha = 1;
  try { ctx.letterSpacing = '0px'; } catch (e) { /* ignore */ }
}

/* Film grain and vignette, drawn last so the whole poster shares one finish. */
function drawFinish(ctx, W, H, seed) {
  const rnd = mulberry32(seed);
  const dots = Math.round((W * H) / 900);
  ctx.save();
  for (let i = 0; i < dots; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    ctx.globalAlpha = 0.03 + rnd() * 0.05;
    ctx.fillStyle = rnd() > 0.5 ? '#ffffff' : '#000000';
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.restore();
  const vig = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.42,
    W / 2, H / 2, Math.max(W, H) * 0.75
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/* ------------------------------------------------------------------ */
/* The one renderer: preview and export share it exactly.             */
/* ------------------------------------------------------------------ */

function drawCover(ctx, W, H) {
  const grade = GRADES[state.grade];
  const seed = 1000 + gradeIndex() * 131 + layoutIndex() * 17 + 42;
  drawSky(ctx, W, H, grade);
  drawSun(ctx, W, H, grade);
  drawSkyline(ctx, W, H, grade, seed);
  const rects = drawPanels(ctx, W, H, grade);
  const area = posterArea(W, H);
  drawPalm(ctx, W * 0.015, area.y + area.h * 0.99, H * 0.26, 0.3, grade.silhouette);
  drawPalm(ctx, W * 0.985, area.y + area.h * 1.0, H * 0.22, -0.25, grade.silhouette);
  drawTitleBlock(ctx, W, H, grade);
  drawSeal(ctx, W, H, grade);
  drawBilling(ctx, W, H, grade);
  drawFinish(ctx, W, H, seed + 7);
  return rects;
}

/* ------------------------------------------------------------------ */
/* Preview                                                            */
/* ------------------------------------------------------------------ */

const stage = document.getElementById('stage');
const stageCtx = stage.getContext('2d');

function renderPreview() {
  const size = EXPORT_SIZES[state.size];
  stage.width = size.w;
  stage.height = size.h;
  lastPreviewSize = { w: size.w, h: size.h };
  lastPanels = drawCover(stageCtx, size.w, size.h);
  syncPanelBar();
}

function syncPanelBar() {
  const picks = document.getElementById('panelPicks');
  const count = panelCount();
  if (state.selected >= count) state.selected = 0;
  picks.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-pick' + (i === state.selected ? ' active' : '');
    btn.textContent = String(i + 1);
    btn.setAttribute('aria-label', 'Select panel ' + (i + 1));
    btn.addEventListener('click', () => {
      state.selected = i;
      renderPreview();
      syncZoomControl();
    });
    picks.appendChild(btn);
  }
  const panel = state.panels[state.selected];
  document.getElementById('fitToggle').textContent = 'Fit: ' + (panel.fit ? 'Fit' : 'Fill');
}

function syncZoomControl() {
  const panel = state.panels[state.selected];
  document.getElementById('zoomRange').value = String(panel.zoom);
}

/* ------------------------------------------------------------------ */
/* Photos: upload, samples, drag and drop, thumbs.                    */
/* ------------------------------------------------------------------ */

function addPhoto(img, name) {
  const entry = { img, name };
  state.library.push(entry);
  state.panels[state.selected] = {
    img,
    name,
    zoom: 1,
    ox: 0,
    oy: 0,
    fit: state.panels[state.selected].fit,
  };
  renderThumbs();
  renderPreview();
  syncZoomControl();
}

function renderThumbs() {
  const strip = document.getElementById('thumbStrip');
  strip.innerHTML = '';
  state.library.forEach((entry) => {
    const thumb = document.createElement('img');
    thumb.src = entry.img.src;
    thumb.alt = entry.name;
    thumb.title = entry.name + ' — click to place in the selected panel';
    thumb.addEventListener('click', () => {
      state.panels[state.selected] = {
        img: entry.img,
        name: entry.name,
        zoom: 1,
        ox: 0,
        oy: 0,
        fit: state.panels[state.selected].fit,
      };
      renderThumbs();
      renderPreview();
      syncZoomControl();
    });
    strip.appendChild(thumb);
  });
}

async function loadSample(name) {
  const img = await loadImage('samples/' + name + '.jpg');
  addPhoto(img, name);
}

function readFilesAsImages(files) {
  const jobs = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    jobs.push(new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        loadImage(String(reader.result))
          .then((img) => resolve({ img, name: file.name }))
          .catch(() => resolve(null));
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    }));
  }
  return Promise.all(jobs).then((done) => done.filter(Boolean));
}

/* ------------------------------------------------------------------ */
/* Export: render the same drawing at full post size and download it. */
/* ------------------------------------------------------------------ */

function exportCover(sizeKey) {
  const size = EXPORT_SIZES[sizeKey];
  const off = document.createElement('canvas');
  off.width = size.w;
  off.height = size.h;
  const offCtx = off.getContext('2d');
  drawCover(offCtx, size.w, size.h);
  const status = document.getElementById('exportStatus');
  status.textContent = 'Rendering ' + size.label + '…';
  off.toBlob((blob) => {
    if (!blob) {
      status.textContent = 'Export failed in this browser — try again.';
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vice-city-cover-' + sizeKey + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status.textContent = 'Saved ' + size.label + ' PNG (' + (blob.size / 1024).toFixed(0) + ' KB).';
  }, 'image/png');
}

/* ------------------------------------------------------------------ */
/* Pointer interaction on the preview: pick a panel, drag its photo,  */
/* scroll to zoom it.                                                 */
/* ------------------------------------------------------------------ */

function canvasPoint(event) {
  const rect = stage.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * lastPreviewSize.w,
    y: ((event.clientY - rect.top) / rect.height) * lastPreviewSize.h,
  };
}

function panelAt(point) {
  for (let i = lastPanels.length - 1; i >= 0; i--) {
    const r = lastPanels[i];
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) return i;
  }
  return -1;
}

let drag = null;

stage.addEventListener('pointerdown', (event) => {
  const point = canvasPoint(event);
  const hit = panelAt(point);
  if (hit < 0) return;
  state.selected = hit;
  syncPanelBar();
  syncZoomControl();
  const panel = state.panels[hit];
  drag = { x: point.x, y: point.y, ox: panel.ox, oy: panel.oy };
  stage.setPointerCapture(event.pointerId);
  renderPreview();
});

stage.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const point = canvasPoint(event);
  const panel = state.panels[state.selected];
  const rect = lastPanels[state.selected];
  if (!rect || !panel.img) return;
  panel.ox = clamp(drag.ox + (point.x - drag.x) / rect.w, -0.6, 0.6);
  panel.oy = clamp(drag.oy + (point.y - drag.y) / rect.h, -0.6, 0.6);
  renderPreview();
});

stage.addEventListener('pointerup', () => { drag = null; });
stage.addEventListener('pointercancel', () => { drag = null; });

stage.addEventListener('wheel', (event) => {
  event.preventDefault();
  const panel = state.panels[state.selected];
  if (!panel.img) return;
  panel.zoom = clamp(panel.zoom * Math.exp(-event.deltaY * 0.0012), 1, 3);
  syncZoomControl();
  renderPreview();
}, { passive: false });

/* ------------------------------------------------------------------ */
/* Control wiring                                                     */
/* ------------------------------------------------------------------ */

document.getElementById('uploadBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', async (event) => {
  const loaded = await readFilesAsImages(event.target.files);
  loaded.forEach((entry, i) => {
    state.selected = Math.min(i, panelCount() - 1);
    addPhoto(entry.img, entry.name);
  });
  event.target.value = '';
});

document.querySelectorAll('[data-sample]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    try {
      await loadSample(btn.dataset.sample);
    } catch (err) {
      document.getElementById('exportStatus').textContent = 'Sample photo failed to load.';
    }
  });
});

document.querySelectorAll('#layoutChoices [data-layout]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#layoutChoices [data-layout]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.layout = btn.dataset.layout;
    state.selected = 0;
    renderPreview();
    syncZoomControl();
  });
});

document.querySelectorAll('#gradeChoices [data-grade]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#gradeChoices [data-grade]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.grade = btn.dataset.grade;
    renderPreview();
  });
});

document.getElementById('titleInput').addEventListener('input', (event) => {
  state.title = event.target.value;
  renderPreview();
});

document.getElementById('taglineInput').addEventListener('input', (event) => {
  state.tagline = event.target.value;
  renderPreview();
});

document.getElementById('titleSizeRange').addEventListener('input', (event) => {
  state.titleSize = Number(event.target.value);
  renderPreview();
});

document.querySelectorAll('[data-letter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-letter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.letter = btn.dataset.letter;
    renderPreview();
  });
});

document.querySelectorAll('[data-place]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-place]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.titlePlace = btn.dataset.place;
    renderPreview();
  });
});

document.getElementById('sealInput').addEventListener('input', (event) => {
  state.seal = event.target.value;
  renderPreview();
});

document.getElementById('billingInput').addEventListener('input', (event) => {
  state.billing = event.target.value;
  renderPreview();
});

document.getElementById('sealCheck').addEventListener('change', (event) => {
  state.showSeal = event.target.checked;
  renderPreview();
});

document.getElementById('billingCheck').addEventListener('change', (event) => {
  state.showBilling = event.target.checked;
  renderPreview();
});

document.getElementById('dotsCheck').addEventListener('change', (event) => {
  state.showDots = event.target.checked;
  renderPreview();
});

document.getElementById('zoomRange').addEventListener('input', (event) => {
  const panel = state.panels[state.selected];
  panel.zoom = Number(event.target.value);
  renderPreview();
});

document.getElementById('fitToggle').addEventListener('click', () => {
  const panel = state.panels[state.selected];
  panel.fit = !panel.fit;
  renderPreview();
  syncPanelBar();
});

document.getElementById('fillAllBtn').addEventListener('click', () => {
  const source = state.panels[state.selected];
  if (!source.img) return;
  for (let i = 0; i < panelCount(); i++) {
    state.panels[i] = { img: source.img, name: source.name, zoom: 1, ox: 0, oy: 0, fit: source.fit };
  }
  renderPreview();
});

document.getElementById('shuffleBtn').addEventListener('click', () => {
  const count = panelCount();
  const photos = state.panels.slice(0, count).map((p) => p.img);
  photos.push(photos.shift());
  for (let i = 0; i < count; i++) {
    state.panels[i] = { img: photos[i], name: state.panels[i].name, zoom: 1, ox: 0, oy: 0, fit: state.panels[i].fit };
  }
  renderPreview();
});

document.getElementById('clearPanelBtn').addEventListener('click', () => {
  state.panels[state.selected] = blankPanel();
  renderPreview();
  syncZoomControl();
});

document.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', () => exportCover(btn.dataset.export));
});

document.querySelectorAll('[data-preview-size]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-preview-size]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.size = btn.dataset.previewSize;
    renderPreview();
  });
});

/* Drag and drop anywhere on the preview. */
['dragover', 'dragenter'].forEach((name) => {
  stage.addEventListener(name, (event) => event.preventDefault());
});
stage.addEventListener('drop', async (event) => {
  event.preventDefault();
  const loaded = await readFilesAsImages(event.dataTransfer.files);
  loaded.forEach((entry, i) => {
    state.selected = Math.min(i, panelCount() - 1);
    addPhoto(entry.img, entry.name);
  });
});

/* ------------------------------------------------------------------ */
/* Screenshot / demo mode, driven by the page URL.                    */
/*   ?shot=cover|editor  ?photo=pier|boulevard  ?caption=...         */
/*   ?tagline=...  ?layout=...  ?grade=...  ?size=square|portrait|   */
/*   wide  ?letter=...  ?place=top|bottom  ?demo=1                    */
/* Cover mode hides the editor chrome and shows only the poster.      */
/* ------------------------------------------------------------------ */

function applyParams() {
  const params = new URLSearchParams(window.location.search);
  const get = (key) => params.get(key);
  if (get('layout') && LAYOUTS[get('layout')]) state.layout = get('layout');
  if (get('grade') && GRADES[get('grade')]) state.grade = get('grade');
  if (get('size') && EXPORT_SIZES[get('size')]) state.size = get('size');
  if (get('letter') && ['block', 'neon', 'slab'].includes(get('letter'))) state.letter = get('letter');
  if (get('place') && ['top', 'bottom'].includes(get('place'))) state.titlePlace = get('place');
  if (get('caption')) state.title = get('caption');
  if (get('tagline')) state.tagline = get('tagline');
  if (get('shot') === 'cover') document.body.classList.add('shot-cover');
  return params;
}

async function boot() {
  const params = applyParams();
  /* Reflect the URL state in the controls before the first paint. */
  document.getElementById('titleInput').value = state.title;
  document.getElementById('taglineInput').value = state.tagline;
  document.getElementById('sealInput').value = state.seal;
  document.getElementById('billingInput').value = state.billing;
  document.querySelectorAll('#layoutChoices [data-layout]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === state.layout);
  });
  document.querySelectorAll('#gradeChoices [data-grade]').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === state.grade);
  });
  document.querySelectorAll('[data-letter]').forEach((b) => {
    b.classList.toggle('active', b.dataset.letter === state.letter);
  });
  document.querySelectorAll('[data-place]').forEach((b) => {
    b.classList.toggle('active', b.dataset.place === state.titlePlace);
  });
  document.querySelectorAll('[data-preview-size]').forEach((b) => {
    b.classList.toggle('active', b.dataset.previewSize === state.size);
  });
  renderPreview();
  /* Demo / shot mode: preload sample photos so the poster is complete. */
  const wanted = params.get('photo');
  const demo = params.get('demo') === '1' || params.get('shot') === 'cover' || wanted;
  if (demo) {
    try {
      const first = await loadImage('samples/' + (wanted || 'pier') + '.jpg');
      const second = await loadImage('samples/' + (wanted === 'boulevard' ? 'pier' : 'boulevard') + '.jpg');
      state.library.push({ img: first, name: wanted || 'pier' });
      state.library.push({ img: second, name: wanted === 'boulevard' ? 'pier' : 'boulevard' });
      const count = panelCount();
      for (let i = 0; i < count; i++) {
        const img = i === 0 ? first : second;
        state.panels[i] = { img, name: img === first ? 'hero' : 'side', zoom: 1, ox: 0, oy: 0, fit: false };
      }
      /* A little variety in the side panels: different crops of the
         second photo, so the three small panels do not repeat. */
      if (count > 1) state.panels[1].zoom = 1.25;
      if (count > 2) {
        state.panels[2].zoom = 1.6;
        state.panels[2].ox = 0.12;
      }
      if (count > 3) {
        state.panels[3].zoom = 1.15;
        state.panels[3].oy = -0.12;
      }
      renderThumbs();
      renderPreview();
    } catch (err) {
      /* Samples missing: the poster still renders with placeholders. */
      renderPreview();
    }
  }
}

boot();
