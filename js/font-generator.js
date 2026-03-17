import { getState, defaultTransforms } from './state.js';
import { showToast } from './utils.js';
import { createZip } from './zip-builder.js';
import { branding } from './branding.js';

// ── SVG Path Parsing ─────────────────────────────────────────

/**
 * Tokenise SVG path d attribute into an array of { cmd, args } objects.
 */
function parseSvgPathData(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];
  const cmds = [];
  let cmd = '';
  let args = [];
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) {
      if (cmd) cmds.push({ cmd, args: args.slice() });
      cmd = t; args = [];
    } else {
      args.push(parseFloat(t));
    }
  }
  if (cmd) cmds.push({ cmd, args });
  return cmds;
}

/**
 * Convert SVG path commands to opentype.js Path with coordinate transforms.
 *
 * @param {string}   pathD      - SVG path d attribute
 * @param {Function} tx         - transform x coordinate
 * @param {Function} ty         - transform y coordinate
 * @param {number}   ascender   - font ascender value
 * @param {number}   descender  - font descender value (negative)
 * @returns {opentype.Path}
 */
function svgPathToOpentype(pathD, tx, ty) {
  const p = new opentype.Path();
  const cmds = parseSvgPathData(pathD);
  let cx = 0, cy = 0;
  let sx = 0, sy = 0;
  let lastControl = null;

  for (const { cmd, args } of cmds) {
    switch (cmd) {
      case 'M': {
        for (let i = 0; i < args.length; i += 2) {
          cx = args[i]; cy = args[i + 1];
          if (i === 0) { p.moveTo(tx(cx), ty(cy)); sx = cx; sy = cy; }
          else p.lineTo(tx(cx), ty(cy));
        }
        lastControl = null;
        break;
      }
      case 'm': {
        for (let i = 0; i < args.length; i += 2) {
          cx += args[i]; cy += args[i + 1];
          if (i === 0) { p.moveTo(tx(cx), ty(cy)); sx = cx; sy = cy; }
          else p.lineTo(tx(cx), ty(cy));
        }
        lastControl = null;
        break;
      }
      case 'L': {
        for (let i = 0; i < args.length; i += 2) {
          cx = args[i]; cy = args[i + 1];
          p.lineTo(tx(cx), ty(cy));
        }
        lastControl = null;
        break;
      }
      case 'l': {
        for (let i = 0; i < args.length; i += 2) {
          cx += args[i]; cy += args[i + 1];
          p.lineTo(tx(cx), ty(cy));
        }
        lastControl = null;
        break;
      }
      case 'H': {
        for (const a of args) { cx = a; p.lineTo(tx(cx), ty(cy)); }
        lastControl = null;
        break;
      }
      case 'h': {
        for (const a of args) { cx += a; p.lineTo(tx(cx), ty(cy)); }
        lastControl = null;
        break;
      }
      case 'V': {
        for (const a of args) { cy = a; p.lineTo(tx(cx), ty(cy)); }
        lastControl = null;
        break;
      }
      case 'v': {
        for (const a of args) { cy += a; p.lineTo(tx(cx), ty(cy)); }
        lastControl = null;
        break;
      }
      case 'C': {
        for (let i = 0; i < args.length; i += 6) {
          const x1 = args[i], y1 = args[i+1], x2 = args[i+2], y2 = args[i+3], x = args[i+4], y = args[i+5];
          p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y));
          lastControl = { x: x2, y: y2 };
          cx = x; cy = y;
        }
        break;
      }
      case 'c': {
        for (let i = 0; i < args.length; i += 6) {
          const x1 = cx+args[i], y1 = cy+args[i+1], x2 = cx+args[i+2], y2 = cy+args[i+3], x = cx+args[i+4], y = cy+args[i+5];
          p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y));
          lastControl = { x: x2, y: y2 };
          cx = x; cy = y;
        }
        break;
      }
      case 'S': {
        for (let i = 0; i < args.length; i += 4) {
          let x1, y1;
          if (lastControl) { x1 = 2*cx - lastControl.x; y1 = 2*cy - lastControl.y; }
          else { x1 = cx; y1 = cy; }
          const x2 = args[i], y2 = args[i+1], x = args[i+2], y = args[i+3];
          p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y));
          lastControl = { x: x2, y: y2 };
          cx = x; cy = y;
        }
        break;
      }
      case 's': {
        for (let i = 0; i < args.length; i += 4) {
          let x1, y1;
          if (lastControl) { x1 = 2*cx - lastControl.x; y1 = 2*cy - lastControl.y; }
          else { x1 = cx; y1 = cy; }
          const x2 = cx+args[i], y2 = cy+args[i+1], x = cx+args[i+2], y = cy+args[i+3];
          p.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y));
          lastControl = { x: x2, y: y2 };
          cx = x; cy = y;
        }
        break;
      }
      case 'Q': {
        for (let i = 0; i < args.length; i += 4) {
          const x1 = args[i], y1 = args[i+1], x = args[i+2], y = args[i+3];
          p.quadTo(tx(x1), ty(y1), tx(x), ty(y));
          lastControl = { x: x1, y: y1 };
          cx = x; cy = y;
        }
        break;
      }
      case 'q': {
        for (let i = 0; i < args.length; i += 4) {
          const x1 = cx+args[i], y1 = cy+args[i+1], x = cx+args[i+2], y = cy+args[i+3];
          p.quadTo(tx(x1), ty(y1), tx(x), ty(y));
          lastControl = { x: x1, y: y1 };
          cx = x; cy = y;
        }
        break;
      }
      case 'T': {
        for (let i = 0; i < args.length; i += 2) {
          let x1, y1;
          if (lastControl) { x1 = 2*cx - lastControl.x; y1 = 2*cy - lastControl.y; }
          else { x1 = cx; y1 = cy; }
          const x = args[i], y = args[i+1];
          p.quadTo(tx(x1), ty(y1), tx(x), ty(y));
          lastControl = { x: x1, y: y1 };
          cx = x; cy = y;
        }
        break;
      }
      case 't': {
        for (let i = 0; i < args.length; i += 2) {
          let x1, y1;
          if (lastControl) { x1 = 2*cx - lastControl.x; y1 = 2*cy - lastControl.y; }
          else { x1 = cx; y1 = cy; }
          const x = cx+args[i], y = cy+args[i+1];
          p.quadTo(tx(x1), ty(y1), tx(x), ty(y));
          lastControl = { x: x1, y: y1 };
          cx = x; cy = y;
        }
        break;
      }
      case 'A': case 'a': {
        const isRel = cmd === 'a';
        for (let i = 0; i < args.length; i += 7) {
          const ex = isRel ? cx + args[i+5] : args[i+5];
          const ey = isRel ? cy + args[i+6] : args[i+6];
          arcToCubic(p, cx, cy, args[i], args[i+1], args[i+2], args[i+3], args[i+4], ex, ey, tx, ty);
          cx = ex; cy = ey;
        }
        lastControl = null;
        break;
      }
      case 'Z': case 'z': {
        p.closePath();
        cx = sx; cy = sy;
        lastControl = null;
        break;
      }
    }
  }
  return p;
}

// ── Arc to Cubic Bezier ──────────────────────────────────────

/**
 * Convert an SVG arc to one or more cubic bezier curves.
 */
function arcToCubic(path, x1, y1, rx, ry, angle, largeArc, sweep, x2, y2, tx, ty) {
  if (rx === 0 || ry === 0) { path.lineTo(tx(x2), ty(y2)); return; }
  const phi = angle * Math.PI / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy, y1p = -sinPhi * dx + cosPhi * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const rxsq = rx*rx, rysq = ry*ry, x1psq = x1p*x1p, y1psq = y1p*y1p;
  let sq = Math.max(0, (rxsq*rysq - rxsq*y1psq - rysq*x1psq) / (rxsq*y1psq + rysq*x1psq));
  let f = Math.sqrt(sq) * ((largeArc === sweep) ? -1 : 1);
  const cxp = f * rx * y1p / ry, cyp = -f * ry * x1p / rx;
  const cxo = cosPhi*cxp - sinPhi*cyp + (x1+x2)/2;
  const cyo = sinPhi*cxp + cosPhi*cyp + (y1+y2)/2;
  const theta1 = Math.atan2((y1p-cyp)/ry, (x1p-cxp)/rx);
  let dtheta = Math.atan2((-y1p-cyp)/ry, (-x1p-cxp)/rx) - theta1;
  if (!sweep && dtheta > 0) dtheta -= 2*Math.PI;
  if (sweep && dtheta < 0) dtheta += 2*Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI/2)));
  const dth = dtheta / segments;
  const alpha = 4/3 * Math.tan(dth/4);
  let t1 = theta1;
  for (let i = 0; i < segments; i++) {
    const t2 = t1 + dth;
    const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
    const cos2 = Math.cos(t2), sin2 = Math.sin(t2);
    const ep1x = rx*cos1, ep1y = ry*sin1;
    const ep2x = rx*cos2, ep2y = ry*sin2;
    const cp1x = ep1x - alpha*rx*sin1, cp1y = ep1y + alpha*ry*cos1;
    const cp2x = ep2x + alpha*rx*sin2, cp2y = ep2y - alpha*ry*cos2;
    const bx1 = cosPhi*cp1x - sinPhi*cp1y + cxo, by1 = sinPhi*cp1x + cosPhi*cp1y + cyo;
    const bx2 = cosPhi*cp2x - sinPhi*cp2y + cxo, by2 = sinPhi*cp2x + cosPhi*cp2y + cyo;
    const bx  = cosPhi*ep2x - sinPhi*ep2y + cxo, by  = sinPhi*ep2x + cosPhi*ep2y + cyo;
    path.curveTo(tx(bx1), ty(by1), tx(bx2), ty(by2), tx(bx), ty(by));
    t1 = t2;
  }
}

// ── TTF to WOFF1 Conversion ─────────────────────────────────

/**
 * Wrap a TTF ArrayBuffer in a valid WOFF1 container (uncompressed).
 * Returns a Blob with type font/woff.
 */
function ttfToWoff(ttfArrayBuffer) {
  const ttf = new DataView(ttfArrayBuffer);
  const signature = 0x774F4646; // 'wOFF'

  // Read TTF offset table
  const sfVersion = ttf.getUint32(0);
  const numTables = ttf.getUint16(4);

  // Read table directory
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    tables.push({
      tag: ttf.getUint32(offset),
      checksum: ttf.getUint32(offset + 4),
      offset: ttf.getUint32(offset + 8),
      length: ttf.getUint32(offset + 12)
    });
  }

  // Calculate WOFF size
  const woffHeaderSize = 44;
  const woffDirSize = numTables * 20;
  let dataOffset = woffHeaderSize + woffDirSize;
  const tableEntries = tables.map(t => {
    const paddedLen = (t.length + 3) & ~3;
    const entry = { ...t, woffOffset: dataOffset, compLength: t.length };
    dataOffset += paddedLen;
    return entry;
  });
  const totalSize = dataOffset;

  const woff = new ArrayBuffer(totalSize);
  const view = new DataView(woff);
  const bytes = new Uint8Array(woff);

  // WOFF header
  view.setUint32(0, signature);
  view.setUint32(4, sfVersion);
  view.setUint32(8, totalSize);
  view.setUint16(12, numTables);
  view.setUint16(14, 0);
  view.setUint32(16, ttfArrayBuffer.byteLength);
  view.setUint16(20, 1);
  view.setUint16(22, 0);
  view.setUint32(24, 0);
  view.setUint32(28, 0);
  view.setUint32(32, 0);
  view.setUint32(36, 0);
  view.setUint32(40, 0);

  // Table directory
  tableEntries.forEach((t, i) => {
    const off = woffHeaderSize + i * 20;
    view.setUint32(off, t.tag);
    view.setUint32(off + 4, t.woffOffset);
    view.setUint32(off + 8, t.compLength);
    view.setUint32(off + 12, t.length);
    view.setUint32(off + 16, t.checksum);
  });

  // Copy table data
  const srcBytes = new Uint8Array(ttfArrayBuffer);
  tableEntries.forEach(t => {
    bytes.set(srcBytes.subarray(t.offset, t.offset + t.length), t.woffOffset);
  });

  return new Blob([woff], { type: 'font/woff' });
}

// ── Font Generation ──────────────────────────────────────────

/**
 * Generate .ttf and .woff font files from current mappings.
 * Reads font metrics from state, applies per-glyph transforms,
 * and triggers downloads of both files.
 */
export async function generateFont() {
  if (typeof opentype === 'undefined') {
    showToast('opentype.js not loaded — check internet connection');
    return;
  }

  const s = getState();
  if (!s.fontMeta) {
    showToast('No font loaded — load a font first');
    return;
  }

  const { unitsPerEm, ascender, descender } = s.fontMeta;
  const SVG_SIZE = 24;
  const BASE_SCALE = unitsPerEm / SVG_SIZE;
  const emTop = ascender + Math.abs(descender);
  const fontName = s.fontName || 'IconFont';

  // Build .notdef glyph
  const notdefPath = new opentype.Path();
  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: unitsPerEm,
    path: notdefPath
  });

  const glyphs = [notdefGlyph];
  let builtCount = 0;
  let errorCount = 0;

  // Process all mappings (skip categories)
  const iconMappings = s.mappings.filter(m => !m.isCategory);

  iconMappings.forEach(m => {
    const codepoint = parseInt(m.glyphCodepoint, 16);
    const name = m.glyphName || 'glyph_' + m.glyphCodepoint;

    if (m.svgFilename) {
      const svgEntry = s.svgEntries.find(e => e.filename === m.svgFilename);
      if (svgEntry) {
        try {
          // Determine transforms
          const transforms = m.transforms || defaultTransforms();
          const sizeScale = 1 + (transforms.sizeOffset * 0.05);
          const effectiveScale = BASE_SCALE * sizeScale;
          const xOffset = (unitsPerEm - SVG_SIZE * effectiveScale) / 2;

          // Build tx/ty functions incorporating flip and scale
          function tx(x) {
            let result = x;
            if (transforms.flipH) result = SVG_SIZE - result;
            return result * effectiveScale + xOffset;
          }
          function ty(y) {
            let result = y;
            if (transforms.flipV) result = SVG_SIZE - result;
            return emTop - result * effectiveScale + descender;
          }

          // Parse SVG and extract all path d attributes
          const parser = new DOMParser();
          const doc = parser.parseFromString(svgEntry.svg, 'image/svg+xml');
          const paths = doc.querySelectorAll('path');
          const glyphPath = new opentype.Path();

          paths.forEach(pathEl => {
            const d = pathEl.getAttribute('d');
            if (!d) return;
            const converted = svgPathToOpentype(d, tx, ty);
            // Merge commands
            converted.commands.forEach(cmd => glyphPath.commands.push(cmd));
          });

          glyphs.push(new opentype.Glyph({
            name: name,
            unicode: codepoint,
            advanceWidth: unitsPerEm,
            path: glyphPath
          }));
          builtCount++;
        } catch (e) {
          console.error('Error building glyph ' + name + ':', e);
          errorCount++;
          // Add empty glyph as fallback
          glyphs.push(new opentype.Glyph({
            name: name,
            unicode: codepoint,
            advanceWidth: unitsPerEm,
            path: new opentype.Path()
          }));
        }
      }
    } else {
      // Unmapped: empty glyph to preserve codepoint
      glyphs.push(new opentype.Glyph({
        name: name,
        unicode: codepoint,
        advanceWidth: unitsPerEm,
        path: new opentype.Path()
      }));
    }
  });

  // Create font
  const font = new opentype.Font({
    familyName: fontName,
    styleName: 'Regular',
    unitsPerEm: unitsPerEm,
    ascender: ascender,
    descender: descender,
    glyphs: glyphs
  });

  // Generate ArrayBuffer, build CSS, HTML preview, and download as ZIP
  try {
    const ab = font.toArrayBuffer();
    const ttfData = new Uint8Array(ab);

    // Build WOFF
    const woffBlob = ttfToWoff(ab);
    const woffData = new Uint8Array(await woffBlob.arrayBuffer());

    // Build CSS
    const cssContent = buildCss(fontName, iconMappings);

    // Build HTML preview with embedded base64 fonts (both OTF and WOFF for compatibility)
    const otfBase64 = arrayBufferToBase64(ab);
    const woffBase64 = arrayBufferToBase64(woffData.buffer);
    const htmlContent = buildHtmlPreview(fontName, s.mappings, otfBase64, woffBase64, s.svgEntries, s.fontFile);

    // Build project JSON for re-importing into the tool
    const projectJson = JSON.stringify({
      projectName: fontName,
      exportedAt: new Date().toISOString(),
      fontName: s.fontName,
      fontMeta: s.fontMeta,
      fontBase64: arrayBufferToBase64(s.fontFile),
      glyphs: s.glyphs,
      svgEntries: s.svgEntries,
      mappings: s.mappings,
    });

    // Pack into ZIP
    const files = [
      { name: `${fontName}/font/${fontName}.otf`, data: ttfData },
      { name: `${fontName}/font/${fontName}.woff`, data: woffData },
      { name: `${fontName}/css/${fontName}.css`, data: cssContent },
      { name: `${fontName}/index.html`, data: htmlContent },
      { name: `${fontName}/${fontName}-project.json`, data: projectJson },
    ];

    const zipData = createZip(files);
    const blob = new Blob([zipData], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fontName}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Font generation failed:', e);
    showToast('Error generating font: ' + e.message);
    return;
  }

  const msg = builtCount + ' glyphs built' + (errorCount ? ', ' + errorCount + ' errors' : '');
  showToast(msg + ' — ZIP downloaded');
}

// ── Helpers ──────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── CSS Generation ───────────────────────────────────────────

function buildCss(fontName, iconMappings) {
  const lines = [];

  lines.push(`@font-face {`);
  lines.push(`  font-family: '${fontName}';`);
  lines.push(`  src: url('../font/${fontName}.woff') format('woff'),`);
  lines.push(`       url('../font/${fontName}.otf') format('opentype');`);
  lines.push(`  font-weight: normal;`);
  lines.push(`  font-style: normal;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`[class^="${fontName}-"]:before, [class*=" ${fontName}-"]:before {`);
  lines.push(`  font-family: "${fontName}";`);
  lines.push(`  font-style: normal;`);
  lines.push(`  font-weight: normal;`);
  lines.push(`  speak: never;`);
  lines.push(`  display: inline-block;`);
  lines.push(`  text-decoration: inherit;`);
  lines.push(`  width: 1em;`);
  lines.push(`  text-align: center;`);
  lines.push(`  font-variant: normal;`);
  lines.push(`  text-transform: none;`);
  lines.push(`  line-height: 1em;`);
  lines.push(`  -webkit-font-smoothing: antialiased;`);
  lines.push(`  -moz-osx-font-smoothing: grayscale;`);
  lines.push(`}`);
  lines.push(``);

  for (const m of iconMappings) {
    const name = m.glyphName || 'glyph_' + m.glyphCodepoint;
    const cp = m.glyphCodepoint;
    lines.push(`.${fontName}-${name}:before { content: '\\${cp}'; }`);
  }

  return lines.join('\n') + '\n';
}

// ── HTML Preview Generation ──────────────────────────────────

function buildHtmlPreview(fontName, allMappings, otfBase64, woffBase64, svgEntries, fontFileArrayBuffer) {
  // Build a lookup for SVG content by filename
  const svgMap = {};
  if (svgEntries) {
    for (const e of svgEntries) svgMap[e.filename] = e.svg;
  }

  // Parse original font to extract glyph outlines for unmapped icons
  let originalFont = null;
  if (fontFileArrayBuffer) {
    try { originalFont = opentype.parse(fontFileArrayBuffer); } catch (e) { /* ignore */ }
  }

  // Build HTML grouped by categories (collapsible)
  let content = '';
  let glyphCount = 0;
  let sectionOpen = false;

  for (const m of allMappings) {
    if (m.isCategory) {
      // Close previous section
      if (sectionOpen) content += `</div></div>`;
      content += `<div class="category-section">
        <div class="category-header" onclick="toggleCategory(this)">
          <span class="category-chevron">&#9660;</span>
          <span class="category-title">${escHtml(m.categoryName)}</span>
        </div>
        <div class="category-body"><div class="grid">`;
      sectionOpen = true;
      glyphCount = 0;
      continue;
    }

    const name = m.glyphName || 'glyph_' + m.glyphCodepoint;
    const cp = m.glyphCodepoint;
    const cpUpper = cp.toUpperCase();
    const className = `${escHtml(fontName)}-${escHtml(name)}`;

    let iconHtml;
    if (m.svgFilename && svgMap[m.svgFilename]) {
      iconHtml = `<div class="icon-svg">${svgMap[m.svgFilename]}</div>`;
    } else if (originalFont) {
      const glyphSvg = extractGlyphAsSvg(originalFont, parseInt(cp, 16));
      iconHtml = glyphSvg
        ? `<div class="icon-svg">${glyphSvg}</div>`
        : `<div class="icon-svg icon-empty"></div>`;
    } else {
      iconHtml = `<div class="icon-svg icon-empty"></div>`;
    }

    content += `
      <div class="card" data-name="${escHtml(name)}" data-class="${className}" data-code="U+${cpUpper}">
        ${iconHtml}
        <div class="i-name" onclick="copyText(this, '${className}')">${className}</div>
        <div class="i-code" onclick="copyText(this, 'U+${cpUpper}')">U+${cpUpper}</div>
      </div>`;
    glyphCount++;
  }
  // Close last section
  if (sectionOpen) content += `</div></div></div>`;
  else if (glyphCount > 0) content += `</div>`;

  // Wrap categorized content in a single container with rounded corners
  if (allMappings.some(m => m.isCategory)) {
    content = `<div class="categories-wrapper">${content}</div>`;
  } else {
    content = `<div class="grid">${content}</div>`;
  }

  const totalGlyphs = allMappings.filter(m => !m.isCategory).length;

  const exportLogo = branding.exportLogoHtml || '';
  const exportFooter = branding.exportFooterHtml || '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escHtml(fontName)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px;
    color: #333;
    background: #f5f5f5;
    padding: 24px;
  }
  h1 { font-size: 24px; font-weight: 600; }
  .page-header {
    background: #fff;
    padding: 20px 24px;
    border-radius: 8px;
    margin-bottom: 20px;
    border: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .page-header-left { display: flex; flex-direction: column; gap: 8px; }
  .export-logo { margin-bottom: 4px; }
  .export-logo:empty { display: none; }
  .export-logo img, .export-logo svg { height: 32px; width: auto; }
  .stats { font-size: 12px; color: #888; }
  .search-box {
    padding: 8px 14px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 13px;
    width: 240px;
    outline: none;
    font-family: inherit;
  }
  .search-box:focus { border-color: #2563eb; }
  .info-box {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    margin-bottom: 20px;
    overflow: hidden;
  }
  .info-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: #555;
    user-select: none;
  }
  .info-toggle:hover { background: #f9fafb; }
  .info-chevron { transition: transform 0.15s; font-size: 10px; }
  .info-box.collapsed .info-chevron { transform: rotate(-90deg); }
  .info-box.collapsed .info-content { display: none; }
  .info-content {
    padding: 0 16px 14px;
    font-size: 12px;
    color: #666;
    line-height: 1.6;
  }
  .info-content code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .info-content ul { margin: 6px 0 6px 18px; }
  .categories-wrapper {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }
  .category-section { border-top: 1px solid #e5e7eb; }
  .category-section:first-child { border-top: none; }
  .category-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: #f8f9fa;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid #e5e7eb;
  }
  .category-header:hover { background: #f0f1f3; }
  .category-section.collapsed .category-header { border-bottom: none; }
  .category-section.collapsed .category-body { display: none; }
  .category-chevron { font-size: 10px; color: #999; transition: transform 0.15s; }
  .category-section.collapsed .category-chevron { transform: rotate(-90deg); }
  .category-title {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #555;
  }
  .category-body {
    padding: 10px;
    background: #fff;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
  }
  .card {
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 0;
    padding: 16px 12px;
    text-align: center;
    transition: background 0.15s;
  }
  .card:hover { background: #f0f4ff; }
  .card.hidden { display: none; }
  .icon-svg { width: 40px; height: 40px; margin: 0 auto 10px; }
  .icon-svg svg { width: 100%; height: 100%; display: block; }
  .icon-empty { background: #f3f4f6; border-radius: 4px; }
  .i-name {
    font-size: 11px; color: #555; word-break: break-all; margin-bottom: 4px;
    font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    cursor: pointer; border-radius: 3px; padding: 2px 4px;
    transition: background 0.15s, color 0.15s;
  }
  .i-name:hover { background: #e0e7ff; }
  .i-code {
    font-size: 10px; color: #aaa;
    font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    cursor: pointer; border-radius: 3px; padding: 2px 4px;
    transition: background 0.15s, color 0.15s;
  }
  .i-code:hover { background: #f0f0f0; }
  .copied { background: #dcfce7 !important; color: #16a34a !important; }
  .no-results { text-align: center; color: #aaa; padding: 40px; font-size: 14px; display: none; }
  .export-footer { text-align: center; padding: 16px; font-size: 11px; color: #aaa; margin-top: 24px; }
  .export-footer:empty { display: none; }
  .export-footer a { color: #888; }
</style>
</head>
<body>
  <div class="page-header">
    <div class="page-header-left">
      <div class="export-logo">${exportLogo}</div>
      <h1>${escHtml(fontName)}</h1>
      <div class="stats">${totalGlyphs} glyphs</div>
    </div>
    <input type="text" class="search-box" id="searchBox" placeholder="Search icons..." oninput="filterIcons(this.value)">
  </div>
  <div class="info-box collapsed">
    <div class="info-toggle" onclick="this.parentElement.classList.toggle('collapsed')">
      <span class="info-chevron">&#9660;</span> What's in this package
    </div>
    <div class="info-content">
      <p>This ZIP contains everything needed to use the <strong>${escHtml(fontName)}</strong> icon font:</p>
      <ul>
        <li><code>font/${escHtml(fontName)}.otf</code> — OpenType font file</li>
        <li><code>font/${escHtml(fontName)}.woff</code> — WOFF font file (for web)</li>
        <li><code>css/${escHtml(fontName)}.css</code> — CSS with <code>@font-face</code> and icon class definitions</li>
        <li><code>${escHtml(fontName)}-project.json</code> — Project file (re-import into Font Icon Remapper)</li>
        <li><code>index.html</code> — This preview page</li>
      </ul>
      <p style="margin-top:8px;">Use the CSS classes (e.g. <code>.${escHtml(fontName)}-iconname</code>) in your HTML to display icons.</p>
    </div>
  </div>
  ${content}
  <div class="no-results" id="noResults">No icons found</div>
  <div class="export-footer">${exportFooter}</div>
<script>
function copyText(el, text) {
  const original = el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    el.textContent = 'Copied!';
    el.classList.add('copied');
    setTimeout(() => { el.textContent = original; el.classList.remove('copied'); }, 1000);
  });
}
function filterIcons(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.card').forEach(card => {
    const match = !q || (card.dataset.name || '').toLowerCase().includes(q)
      || (card.dataset.class || '').toLowerCase().includes(q)
      || (card.dataset.code || '').toLowerCase().includes(q);
    card.classList.toggle('hidden', !match);
  });
  const visible = document.querySelectorAll('.card:not(.hidden)').length;
  document.getElementById('noResults').style.display = visible === 0 ? 'block' : 'none';
}
function toggleCategory(header) {
  header.closest('.category-section').classList.toggle('collapsed');
}
</script>
</body>
</html>
`;
}

// Extract a glyph from the original font as an SVG string
function extractGlyphAsSvg(font, unicode) {
  try {
    for (let i = 0; i < font.numGlyphs; i++) {
      const g = font.glyphs.get(i);
      if (g.unicode === unicode) {
        const path = g.getPath(0, 0, font.unitsPerEm);
        if (!path.commands || path.commands.length === 0) return null;
        const bb = path.getBoundingBox();
        if (bb.x1 === bb.x2 || bb.y1 === bb.y2) return null;
        // Add padding
        const pad = (bb.x2 - bb.x1) * 0.05;
        const vx = Math.floor(bb.x1 - pad);
        const vy = Math.floor(bb.y1 - pad);
        const vw = Math.ceil(bb.x2 - bb.x1 + pad * 2);
        const vh = Math.ceil(bb.y2 - bb.y1 + pad * 2);
        const pathData = path.toPathData(2);
        if (!pathData) return null;
        return `<svg width="24" height="24" viewBox="${vx} ${vy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg"><path d="${pathData}" fill="#333"/></svg>`;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}
