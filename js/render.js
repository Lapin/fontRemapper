import { getState, subscribe, notify } from './state.js';
import { showToast } from './utils.js';
import { handleFontFile, parseCssForGlyphNames, applyCssNames } from './font-parser.js';
import { loadSvgFiles } from './svg-loader.js';
import { autoSave } from './persistence.js';
import { autoMatch } from './auto-match.js';
import { initDragDrop } from './drag-drop.js';
import { addCategory, collapseAll, expandAll } from './categories.js';
import { openEditModal } from './edit-modal.js';
import { defaultTransforms } from './state.js';

const FONT_EXTENSIONS = ['.ttf', '.woff', '.otf'];

let currentView = null; // 'landing' | 'mapping'

// Track collapsed categories by their _id
export const collapsedCategories = new Set();

// ===== Drop zone wiring =====

function setupDropZone(zoneId, inputId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handler(e.dataTransfer.files);
    }
  });

  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handler(e.target.files);
    }
    e.target.value = '';
  });
}

// ===== Font drop handler =====

function handleFontDrop(files) {
  if (!files || files.length === 0) return;

  // Separate font files from CSS files
  const fontFiles = [];
  const cssFiles = [];
  for (const file of files) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (FONT_EXTENSIONS.includes(ext)) fontFiles.push(file);
    else if (ext === '.css') cssFiles.push(file);
  }

  if (fontFiles.length === 0 && cssFiles.length === 0) {
    showToast('Please drop a font file (.ttf, .woff, .otf) and optionally a CSS file.');
    return;
  }

  // If only CSS dropped and font already loaded, just apply names
  if (fontFiles.length === 0 && cssFiles.length > 0 && getState().fontFile) {
    handleCssFile(cssFiles[0]);
    return;
  }

  if (fontFiles.length === 0) {
    showToast('Please drop a font file first, then the CSS.');
    return;
  }

  // Read font file first, then CSS if present
  const fontFile = fontFiles[0];
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const result = handleFontFile(ev.target.result);
      let msg = `Loaded "${result.fontName}" with ${result.glyphCount} glyphs`;

      // If CSS file was dropped alongside, apply names
      if (cssFiles.length > 0) {
        handleCssFile(cssFiles[0], () => {
          showToast(msg + ' — names applied from CSS');
        });
      } else if (pendingCssFile) {
        // CSS was dropped before font — apply it now
        applyPendingCss();
        showToast(msg + ' — names applied from queued CSS');
      } else {
        showToast(msg);
      }
    } catch (err) {
      console.error('Font parse error:', err);
      showToast('Failed to parse font file. Is it a valid font?');
    }
  };
  reader.onerror = () => showToast('Failed to read font file.');
  reader.readAsArrayBuffer(fontFile);
}

// Store pending CSS if dropped before font
let pendingCssFile = null;
let cssWasApplied = false;

function handleCssDrop(files) {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!file.name.toLowerCase().endsWith('.css')) {
    showToast('Please drop a .css file.');
    return;
  }
  if (!getState().fontFile) {
    // Store for later — will be applied when font loads
    pendingCssFile = file;
    // Show checkmark on the CSS drop zone
    const zone = document.getElementById('cssDropZone');
    if (zone) {
      zone.querySelector('.drop-zone-title').textContent = file.name;
      zone.querySelector('.drop-zone-sub').textContent = 'Ready — will apply when font is loaded';
      zone.querySelector('.drop-zone-icon').innerHTML = '&#x2705;';
    }
    showToast(`CSS "${file.name}" queued — drop a font file to continue`);
    return;
  }
  handleCssFile(file);
}

// Called after font loads to check for pending CSS
function applyPendingCss() {
  if (pendingCssFile) {
    const file = pendingCssFile;
    pendingCssFile = null;
    handleCssFile(file);
  }
}

function handleCssFile(file, callback) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = parseCssForGlyphNames(ev.target.result);
      const count = Object.keys(parsed.nameMap).length;
      if (count === 0) {
        showToast('No icon definitions found in CSS file.');
        return;
      }
      const applied = applyCssNames(parsed);
      cssWasApplied = true;
      if (callback) callback();
      else showToast(`Applied ${applied} glyph names from CSS`);
    } catch (err) {
      console.error('CSS parse error:', err);
      showToast('Failed to parse CSS file.');
    }
  };
  reader.onerror = () => showToast('Failed to read CSS file.');
  reader.readAsText(file);
}

// ===== SVG drop handler =====

async function handleSvgDrop(files) {
  const { loaded, skipped } = await loadSvgFiles(files);
  let msg = `Loaded ${loaded} SVG${loaded !== 1 ? 's' : ''}`;
  if (skipped > 0) msg += ` (${skipped} skipped)`;
  showToast(msg);
  if (currentView === 'mapping') {
    renderPool();
  }
}

// ===== Header button state =====

export function updateHeaderButtons() {
  const s = getState();
  const hasFont = !!s.fontFile;
  document.querySelectorAll('[data-requires-font]').forEach(btn => {
    btn.disabled = !hasFont;
  });
}

// ===== Landing view =====

export function renderLanding() {
  currentView = 'landing';
  const main = document.getElementById('mainArea');
  if (!main) return;

  main.innerHTML = `
    <div class="landing">
      <div class="drop-zones">
        <div class="drop-zone" id="fontDropZone">
          <div class="drop-zone-icon">&#x1F5DB;</div>
          <div class="drop-zone-title">Drop Font File</div>
          <div class="drop-zone-sub">.ttf, .woff, or .otf</div>
          <input type="file" id="fontFileInput" accept=".ttf,.woff,.otf,.css" multiple hidden>
        </div>
        <div class="drop-zone" id="cssDropZone">
          <div class="drop-zone-icon" style="color:#7c3aed;">&#x1F3F7;</div>
          <div class="drop-zone-title">Drop CSS File</div>
          <div class="drop-zone-sub">Optional — adds glyph names</div>
          <input type="file" id="cssFileInput" accept=".css" hidden>
        </div>
        <div class="drop-zone" id="svgDropZone">
          <div class="drop-zone-icon" style="color:#16a34a;">&#x1F5BC;</div>
          <div class="drop-zone-title">Drop SVG Icons</div>
          <div class="drop-zone-sub">Select or drop multiple .svg files</div>
          <input type="file" id="svgFileInput" accept=".svg" multiple hidden>
        </div>
      </div>
      <button class="btn btn-primary btn-start" id="btnStartMapping" disabled>Start Mapping</button>
    </div>
  `;

  setupDropZone('fontDropZone', 'fontFileInput', handleFontDrop);
  setupDropZone('cssDropZone', 'cssFileInput', handleCssDrop);
  setupDropZone('svgDropZone', 'svgFileInput', handleSvgDrop);

  document.getElementById('btnStartMapping')?.addEventListener('click', () => {
    if (getState().fontFile) {
      renderMappingView();
    }
  });

  updateHeaderButtons();
  updateLandingState();
}

// ===== Mapping view =====

export function renderMappingView() {
  currentView = 'mapping';
  const main = document.getElementById('mainArea');
  if (!main) return;

  const s = getState();

  main.innerHTML = `
    <div class="workspace">
      <div class="workspace-columns">
        <!-- Left: Glyph Table -->
        <div class="section section-mapping">
          <div class="section-header">
            <h3 class="section-title">Glyph Table</h3>
            <div class="section-header-top">
              <div class="font-name-group">
                <input class="font-name-input" id="fontNameInput" value="${escHtml(s.fontName || 'Untitled Font')}">
                <div class="font-name-hint">This name is used for exported files (e.g. <strong>${escHtml(s.fontName || 'fontname')}-star</strong>)</div>
              </div>
              <div class="mapping-controls-right">
                <button class="btn btn-secondary" id="btnEditSelected" disabled>Edit</button>
                <button class="btn btn-secondary" id="btnAddCategory">+ Category</button>
                <button class="btn btn-primary" id="btnAutoMatch">Auto-Match</button>
              </div>
            </div>
            <input class="section-search" id="mainSearch" placeholder="Search glyphs..." value="${escHtml(s.searchQuery)}">
            <div class="filter-btns">
              <button class="filter-btn${s.filter === 'all' ? ' active' : ''}" data-filter="all">All</button>
              <button class="filter-btn${s.filter === 'matched' ? ' active' : ''}" data-filter="matched">Matched</button>
              <button class="filter-btn${s.filter === 'unmatched' ? ' active' : ''}" data-filter="unmatched">Unmatched</button>
              <button class="filter-btn${s.filter === 'new' ? ' active' : ''}" data-filter="new">New</button>
            </div>
          </div>
          <div class="mapping-header">
            <div class="col-head" style="width:20px;"></div>
            <div class="col-head col-idx">#</div>
            <div class="col-head col-font">Font Glyph</div>
            <div class="col-resize" id="colResize"></div>
            <div class="col-head col-svg">Mapped SVG</div>
          </div>
          <div class="mapping-scroll" id="mappingScroll">
            <div id="mappingList"></div>
            <div class="mapping-footer-actions">
              <div class="add-row-btn" id="btnAddSlot">+ Add new icon slot</div>
              <div class="add-row-btn" id="btnAddCatBottom">+ Add category</div>
            </div>
          </div>
          <div class="mapping-stats-row">
            <span class="stats" id="stats"></span>
          </div>
        </div>

        <!-- Resize handle between panels -->
        <div class="panel-resize" id="panelResize"></div>

        <!-- Right: SVG Pool -->
        <div class="section section-pool" id="sectionPool">
          <div class="section-header">
            <div class="section-header-top">
              <h3 class="section-title">SVG Pool <span class="pool-count" id="poolCount"></span></h3>
            </div>
            <input class="section-search" id="poolSearch" placeholder="Search SVGs...">
            <div class="filter-btns pool-filter-btns">
              <button class="filter-btn active" data-pool-filter="all">All</button>
              <button class="filter-btn" data-pool-filter="free">Free</button>
              <button class="filter-btn" data-pool-filter="used">Used</button>
            </div>
          </div>
          <div class="pool-scroll" id="poolScroll"></div>
        </div>
      </div>
    </div>
  `;

  renderMappingList();
  renderPool();
  updateStats();
  wireMapEvents();
  updateHeaderButtons();
  initDragDrop();
}

// ===== Render the mapping list =====

function renderMappingList() {
  const container = document.getElementById('mappingList');
  if (!container) return;

  const s = getState();
  const mappings = s.mappings;
  const query = s.searchQuery.toLowerCase();
  const filter = s.filter;

  // Build set of assigned SVG filenames for pool
  // Determine visibility per row
  let html = '';
  let insideCollapsed = false;
  let currentCategoryId = null;
  let visibleIdx = 0;

  for (let i = 0; i < mappings.length; i++) {
    const entry = mappings[i];

    if (entry.isCategory) {
      insideCollapsed = collapsedCategories.has(entry._id);
      currentCategoryId = entry._id;

      // For category rows, check filter visibility
      if (filter === 'new') continue; // categories not relevant in "new" filter

      // Count matched/total in this category
      const { matched, total } = countCategoryItems(mappings, i);
      const isCollapsed = collapsedCategories.has(entry._id);
      const isSelected = s.selectedRows.has(i);

      html += `<div class="category-row${isSelected ? ' selected' : ''}" data-idx="${i}">
        <div class="row-drag-handle">&#9776;</div>
        <button class="category-toggle${isCollapsed ? ' collapsed' : ''}" data-id="${escHtml(entry._id)}">&#9660;</button>
        <div class="category-label" contenteditable>${escHtml(entry.categoryName)}</div>
        <span class="category-count">(${matched}/${total} matched)</span>
        <button class="category-delete" data-idx="${i}">&times;</button>
      </div>`;
      continue;
    }

    // Icon mapping row
    if (insideCollapsed) continue;

    // Apply filters
    if (!passesFilter(entry, filter)) continue;

    // Apply search
    if (query && !entry.glyphName.toLowerCase().includes(query)) continue;

    visibleIdx++;
    const isSelected = s.selectedRows.has(i);
    const hasSvg = !!entry.svgFilename;
    const isNew = !!entry.isNew;

    const codepoint = entry.glyphCodepoint || '';
    const codepointUpper = codepoint.toUpperCase();

    // Font glyph preview
    const fontFamily = s.fontName ? escHtml(s.fontName) : '';
    const glyphPreview = codepoint
      ? `<div class="glyph-preview" style="font-family:'${fontFamily}'">&amp;#x${codepoint};</div>`
      : `<div class="glyph-preview empty"></div>`;

    // SVG slot
    let svgSlotContent;
    if (hasSvg) {
      const svgEntry = s.svgEntries.find(e => e.filename === entry.svgFilename);
      const svgMarkup = svgEntry ? svgEntry.svg : '';
      const svgName = svgEntry ? svgEntry.name : entry.svgFilename;
      svgSlotContent = `
        <div class="svg-preview">${svgMarkup}</div>
        <div class="svg-name">${escHtml(svgName)}</div>
        <button class="remove-btn" data-idx="${i}">&times;</button>
      `;
    } else {
      svgSlotContent = `<span class="slot-placeholder">Drop SVG here</span>`;
    }

    html += `<div class="mapping-row${isSelected ? ' selected' : ''}${isNew ? ' new-entry' : ''}" data-idx="${i}">
      <div class="row-drag-handle">&#9776;</div>
      <div class="row-idx">${visibleIdx}</div>
      <div class="row-font">
        ${glyphPreview}
        <div class="glyph-info">
          <div class="glyph-name">${escHtml(entry.glyphName || '')}</div>
          <div class="glyph-code">U+${codepointUpper}</div>
        </div>
      </div>
      <div class="row-svg">
        <div class="svg-slot${hasSvg ? ' has-svg' : ''}" data-idx="${i}">
          ${svgSlotContent}
        </div>
      </div>
    </div>`;
  }

  container.innerHTML = html;

  // Fix glyph preview rendering (innerHTML doesn't parse &#x entities set via template)
  container.querySelectorAll('.glyph-preview[style]').forEach(el => {
    const row = el.closest('.mapping-row');
    if (!row) return;
    const idx = parseInt(row.dataset.idx, 10);
    const entry = s.mappings[idx];
    if (entry && entry.glyphCodepoint) {
      el.innerHTML = `&#x${entry.glyphCodepoint};`;
    }
  });

  // Update Edit button state — enabled when exactly one non-category row is selected
  updateEditButtonState();
}

function updateEditButtonState() {
  const btn = document.getElementById('btnEditSelected');
  if (!btn) return;
  const s = getState();
  let enabled = false;
  if (s.selectedRows.size === 1) {
    const idx = [...s.selectedRows][0];
    const m = s.mappings[idx];
    if (m && !m.isCategory) enabled = true;
  }
  btn.disabled = !enabled;
}

// ===== Count items in a category =====

function countCategoryItems(mappings, catIdx) {
  let matched = 0, total = 0;
  for (let j = catIdx + 1; j < mappings.length; j++) {
    if (mappings[j].isCategory) break;
    total++;
    if (mappings[j].svgFilename) matched++;
  }
  return { matched, total };
}

// ===== Filter check =====

function passesFilter(entry, filter) {
  switch (filter) {
    case 'matched': return !!entry.svgFilename;
    case 'unmatched': return !entry.svgFilename;
    case 'new': return !!entry.isNew;
    default: return true;
  }
}

// ===== Render the SVG pool =====

let poolFilter = 'all'; // 'all' | 'free' | 'used'
const collapsedPoolSections = new Set(); // 'free' | 'used'

function renderPool() {
  const container = document.getElementById('poolScroll');
  if (!container) return;

  const s = getState();
  const poolSearch = document.getElementById('poolSearch');
  const poolQuery = poolSearch ? poolSearch.value.toLowerCase() : '';

  // Determine which SVGs are assigned
  const assignedSet = new Set();
  for (const m of s.mappings) {
    if (!m.isCategory && m.svgFilename) {
      assignedSet.add(m.svgFilename);
    }
  }

  const free = [];
  const used = [];

  for (const entry of s.svgEntries) {
    if (poolQuery && !entry.name.toLowerCase().includes(poolQuery)) continue;
    if (assignedSet.has(entry.filename)) {
      used.push(entry);
    } else {
      free.push(entry);
    }
  }

  let html = '';
  const freeCollapsed = collapsedPoolSections.has('free');
  const usedCollapsed = collapsedPoolSections.has('used');

  // Free section
  if (poolFilter === 'all' || poolFilter === 'free') {
    html += `<div class="pool-section-header" data-pool-section="free">
      <span class="pool-section-chevron${freeCollapsed ? ' collapsed' : ''}">&#9660;</span>
      Free <span class="section-count">(${free.length})</span>
    </div>`;
    if (!freeCollapsed) {
      for (const entry of free) {
        html += poolItemHtml(entry, false);
      }
    }
  }

  // Used section
  if (poolFilter === 'all' || poolFilter === 'used') {
    html += `<div class="pool-section-header" data-pool-section="used">
      <span class="pool-section-chevron${usedCollapsed ? ' collapsed' : ''}">&#9660;</span>
      Used <span class="section-count">(${used.length})</span>
    </div>`;
    if (!usedCollapsed) {
      for (const entry of used) {
        html += poolItemHtml(entry, true);
      }
    }
  }

  container.innerHTML = html;

  // Wire pool section collapse/expand
  container.querySelectorAll('.pool-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.dataset.poolSection;
      if (collapsedPoolSections.has(section)) {
        collapsedPoolSections.delete(section);
      } else {
        collapsedPoolSections.add(section);
      }
      renderPool();
      initDragDrop();
    });
  });

  // Update pool count badge
  const poolCount = document.getElementById('poolCount');
  if (poolCount) {
    poolCount.textContent = `(${s.svgEntries.length})`;
  }
}

function poolItemHtml(entry, isUsed) {
  return `<div class="pool-item${isUsed ? ' used' : ''}" draggable="true" data-filename="${escHtml(entry.filename)}">
    <div class="svg-thumb">${entry.svg}</div>
    <div class="pool-name">${escHtml(entry.name)}</div>
  </div>`;
}

// ===== Update stats =====

function updateStats() {
  const el = document.getElementById('stats');
  if (!el) return;

  const s = getState();
  let totalSlots = 0;
  let mappedSlots = 0;
  let newEntries = 0;

  for (const m of s.mappings) {
    if (m.isCategory) continue;
    totalSlots++;
    if (m.svgFilename) mappedSlots++;
    if (m.isNew) newEntries++;
  }

  let text = `${mappedSlots} of ${totalSlots} mapped`;
  if (newEntries > 0) text += ` | ${newEntries} new entries`;
  el.textContent = text;
}

// ===== Event wiring =====

function wireMapEvents() {
  const s = getState();

  // Font name input (editable) + hint update
  const fontNameInput = document.getElementById('fontNameInput');
  if (fontNameInput) {
    const updateHint = () => {
      const hint = document.querySelector('.font-name-hint strong');
      if (hint) hint.textContent = (fontNameInput.value.trim() || 'fontname') + '-star';
    };
    fontNameInput.addEventListener('input', updateHint);
    fontNameInput.addEventListener('change', () => {
      const val = fontNameInput.value.trim();
      if (val) {
        s.fontName = val;
        autoSave();
      }
    });
  }

  // Global drag-drop on mapping view — accept CSS and SVG files dropped anywhere
  // IMPORTANT: only intercept external file drags, not internal row/pool/slot drags
  const mainArea = document.getElementById('mainArea');
  if (mainArea) {
    mainArea.addEventListener('dragover', (e) => {
      // Only handle external file drags — skip internal drags (row reorder, pool, slot)
      if (e.dataTransfer.types.includes('application/x-row-drag')) return;
      if (e.dataTransfer.types.includes('application/x-pool-item')) return;
      if (e.dataTransfer.types.includes('application/x-slot-idx')) return;
      // Check if this looks like an external file drag
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    mainArea.addEventListener('drop', (e) => {
      // Only handle file drops (not internal drag-drop)
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      if (e.dataTransfer.types.includes('application/x-row-drag')) return;
      if (e.dataTransfer.types.includes('application/x-pool-item')) return;
      if (e.dataTransfer.types.includes('application/x-slot-idx')) return;

      e.preventDefault();
      const files = e.dataTransfer.files;
      const cssFiles = [];
      const svgFiles = [];
      for (const f of files) {
        const name = f.name.toLowerCase();
        if (name.endsWith('.css')) cssFiles.push(f);
        else if (name.endsWith('.svg')) svgFiles.push(f);
      }
      if (cssFiles.length > 0) handleCssFile(cssFiles[0]);
      if (svgFiles.length > 0) handleSvgDrop(svgFiles);
      if (cssFiles.length === 0 && svgFiles.length === 0) {
        showToast('Drop .css or .svg files here');
      }
    });
  }

  // Search input
  const mainSearch = document.getElementById('mainSearch');
  if (mainSearch) {
    mainSearch.addEventListener('input', () => {
      s.searchQuery = mainSearch.value;
      autoSave();
      renderMappingList();
      updateStats();
    });
  }

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      s.filter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      autoSave();
      renderMappingList();
      updateStats();
    });
  });

  // Pool search
  const poolSearch = document.getElementById('poolSearch');
  if (poolSearch) {
    poolSearch.addEventListener('input', () => {
      renderPool();
    });
  }

  // Category toggle (collapse/expand) via delegation
  const mappingList = document.getElementById('mappingList');
  if (mappingList) {
    mappingList.addEventListener('click', (e) => {
      // Category toggle
      const toggleBtn = e.target.closest('.category-toggle');
      if (toggleBtn) {
        const catId = toggleBtn.dataset.id;
        if (collapsedCategories.has(catId)) {
          collapsedCategories.delete(catId);
        } else {
          collapsedCategories.add(catId);
        }
        renderMappingList();
        updateStats();
        return;
      }

      // Category label edit blur -> save
      // handled below via focusout

      // Category delete — only removes the category separator, keeps glyphs
      const deleteBtn = e.target.closest('.category-delete');
      if (deleteBtn) {
        const idx = parseInt(deleteBtn.dataset.idx, 10);
        const entry = s.mappings[idx];
        // Remove from collapsed set so orphaned glyphs don't stay hidden
        if (entry && entry._id) collapsedCategories.delete(entry._id);
        s.mappings.splice(idx, 1);
        autoSave();
        notify();
        return;
      }

      // Remove SVG from slot
      const removeBtn = e.target.closest('.remove-btn');
      if (removeBtn) {
        const idx = parseInt(removeBtn.dataset.idx, 10);
        if (s.mappings[idx]) {
          s.mappings[idx].svgFilename = null;
          autoSave();
          renderMappingList();
          renderPool();
          updateStats();
        }
        return;
      }

      // Click on mapped SVG slot -> scroll to and highlight in pool
      const svgSlot = e.target.closest('.svg-slot.has-svg');
      if (svgSlot) {
        const idx = parseInt(svgSlot.dataset.idx, 10);
        const entry = s.mappings[idx];
        if (entry && entry.svgFilename) {
          highlightPoolItem(entry.svgFilename);
        }
        return;
      }

      // Skip if clicking an interactive element (button, input, contenteditable, draggable handle)
      if (e.target.closest('button, input, [contenteditable], .row-drag-handle')) return;

      // Row selection
      const row = e.target.closest('.mapping-row, .category-row');
      if (row) {
        const idx = parseInt(row.dataset.idx, 10);
        if (isNaN(idx)) return;

        if (e.shiftKey && s.lastClickedRow !== null) {
          // Range select
          const start = Math.min(s.lastClickedRow, idx);
          const end = Math.max(s.lastClickedRow, idx);
          s.selectedRows.clear();
          for (let i = start; i <= end; i++) {
            s.selectedRows.add(i);
          }
        } else if (e.metaKey || e.ctrlKey) {
          // Cmd/Ctrl+click: toggle without clearing others
          if (s.selectedRows.has(idx)) {
            s.selectedRows.delete(idx);
          } else {
            s.selectedRows.add(idx);
          }
          s.lastClickedRow = idx;
        } else {
          // Normal click: select only this row
          if (s.selectedRows.has(idx) && s.selectedRows.size === 1) {
            s.selectedRows.delete(idx);
          } else {
            s.selectedRows.clear();
            s.selectedRows.add(idx);
          }
          s.lastClickedRow = idx;
        }
        renderMappingList();
        initDragDrop();
        return;
      }
    });

    // Category label edit via focusout
    mappingList.addEventListener('focusout', (e) => {
      if (e.target.classList.contains('category-label')) {
        const row = e.target.closest('.category-row');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        const newName = e.target.textContent.trim();
        if (s.mappings[idx] && s.mappings[idx].isCategory && newName) {
          s.mappings[idx].categoryName = newName;
          autoSave();
        }
      }
    });

    // Prevent Enter key from creating new lines in contenteditable category labels
    mappingList.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('category-label') && e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      }
    });
  }

  // Escape key clears selection (document-level)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && s.selectedRows.size > 0) {
      s.selectedRows.clear();
      s.lastClickedRow = null;
      renderMappingList();
      initDragDrop();
    }
  });

  // Pool drop zone for additional SVG files
  const poolScroll = document.getElementById('poolScroll');
  if (poolScroll) {
    poolScroll.addEventListener('dragover', (e) => {
      // Only handle file drops (not pool item drags)
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        poolScroll.classList.add('drag-over');
      }
    });
    poolScroll.addEventListener('dragleave', (e) => {
      e.preventDefault();
      poolScroll.classList.remove('drag-over');
    });
    poolScroll.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) {
        e.preventDefault();
        poolScroll.classList.remove('drag-over');
        handleSvgDrop(e.dataTransfer.files);
      }
    });
  }

  // Add new slot button
  const btnAddSlot = document.getElementById('btnAddSlot');
  if (btnAddSlot) {
    btnAddSlot.addEventListener('click', () => {
      const n = nextNewIconNumber(s.mappings);
      const defaultName = `new-icon-${n}`;
      const name = prompt('Glyph name:', defaultName);
      if (name === null) return; // cancelled
      const glyphName = name.trim() || defaultName;
      const nextCode = nextCodepoint(s.mappings);
      s.mappings.push({
        glyphName,
        glyphCodepoint: nextCode,
        svgFilename: null,
        isNew: true,
        transforms: defaultTransforms(),
      });
      autoSave();
      renderMappingList();
      updateStats();
      // Scroll to bottom
      const scroll = document.getElementById('mappingScroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
  }

  // Edit button (enabled when exactly one non-category row is selected)
  const btnEditSelected = document.getElementById('btnEditSelected');
  if (btnEditSelected) {
    btnEditSelected.addEventListener('click', () => {
      const s = getState();
      if (s.selectedRows.size === 1) {
        const idx = [...s.selectedRows][0];
        const m = s.mappings[idx];
        if (m && !m.isCategory) {
          openEditModal(idx);
        }
      }
    });
  }

  // Auto-Match button
  const btnAutoMatch = document.getElementById('btnAutoMatch');
  if (btnAutoMatch) {
    btnAutoMatch.addEventListener('click', () => {
      const count = autoMatch();
      showToast(count > 0 ? `Auto-matched ${count} glyph${count !== 1 ? 's' : ''}` : 'No new matches found');
    });
  }

  // Add category at bottom button
  const btnAddCatBottom = document.getElementById('btnAddCatBottom');
  if (btnAddCatBottom) {
    btnAddCatBottom.addEventListener('click', () => {
      addCategory(-1, 'New Category');
    });
  }

  // Add category button (header)
  const btnAddCategory = document.getElementById('btnAddCategory');
  if (btnAddCategory) {
    btnAddCategory.addEventListener('click', () => {
      addCategory(-1, 'New Category');
    });
  }

  // Pool filter buttons (All / Free / Used)
  document.querySelectorAll('[data-pool-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.poolFilter;
      if (val === 'all') {
        poolFilter = 'all';
      } else if (poolFilter === val) {
        // Deselect → go back to all
        poolFilter = 'all';
      } else {
        poolFilter = val;
      }
      // Update button states
      document.querySelectorAll('[data-pool-filter]').forEach(b => {
        b.classList.toggle('active', b.dataset.poolFilter === poolFilter);
      });
      renderPool();
      initDragDrop();
    });
  });

  // Panel resize handle (between mapping and pool)
  const panelResize = document.getElementById('panelResize');
  const sectionPool = document.getElementById('sectionPool');
  if (panelResize && sectionPool) {
    let startX, startWidth;
    panelResize.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startWidth = sectionPool.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (e) => {
        const diff = startX - e.clientX;
        const newWidth = Math.max(200, Math.min(600, startWidth + diff));
        sectionPool.style.width = newWidth + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Column resize handle (between font glyph and mapped SVG columns)
  const colResize = document.getElementById('colResize');
  if (colResize) {
    let startX, startLeftWidth;
    const mappingSection = document.querySelector('.section-mapping');
    const colFont = document.querySelector('.col-font');
    colResize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startLeftWidth = colFont ? colFont.offsetWidth : 200;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (e) => {
        const diff = e.clientX - startX;
        const newWidth = Math.max(120, Math.min(startLeftWidth + diff, (mappingSection?.offsetWidth || 800) - 200));
        // Use CSS variable so it persists across re-renders
        document.documentElement.style.setProperty('--col-font-width', newWidth + 'px');
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

// ===== Highlight pool item =====

function highlightPoolItem(filename) {
  // Clear pool search filter so the item is visible
  const poolSearch = document.getElementById('poolSearch');
  if (poolSearch && poolSearch.value) {
    poolSearch.value = '';
    renderPool();
  }

  const poolScroll = document.getElementById('poolScroll');
  if (!poolScroll) return;

  const item = poolScroll.querySelector(`.pool-item[data-filename="${CSS.escape(filename)}"]`);
  if (!item) return;

  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  item.classList.add('highlight');
  setTimeout(() => item.classList.remove('highlight'), 2000);
}

// ===== Get next available codepoint =====

function nextCodepoint(mappings) {
  const existing = mappings.filter(m => !m.isCategory && m.glyphCodepoint)
    .map(m => parseInt(m.glyphCodepoint, 16));
  const max = existing.length > 0 ? Math.max(...existing) : 0xE8FF;
  return Math.max(max + 1, 0xE900).toString(16);
}

// ===== Next new-icon number =====

function nextNewIconNumber(mappings) {
  let max = 0;
  for (const m of mappings) {
    if (m.isCategory) continue;
    const match = (m.glyphName || '').match(/^new-icon-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

// ===== HTML escaping =====

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Exported re-render helpers =====

export function refreshMappingList() {
  if (currentView !== 'mapping') return;
  renderMappingList();
  renderPool();
  updateStats();
  initDragDrop();
}

// ===== State subscription =====

subscribe((state) => {
  updateHeaderButtons();
  if (currentView === 'landing') {
    updateLandingState();
  } else if (currentView === 'mapping') {
    renderMappingList();
    renderPool();
    updateStats();
    initDragDrop();
  }
});

// Update landing drop zones to show checkmarks for loaded items
function updateLandingState() {
  const s = getState();

  const fontZone = document.getElementById('fontDropZone');
  if (fontZone) {
    if (s.fontFile) {
      fontZone.querySelector('.drop-zone-icon').innerHTML = '&#x2705;';
      fontZone.querySelector('.drop-zone-title').textContent = s.fontName || 'Font loaded';
      fontZone.querySelector('.drop-zone-sub').textContent = `${s.glyphs.length} glyphs`;
      fontZone.classList.add('done');
    }
  }

  const svgZone = document.getElementById('svgDropZone');
  if (svgZone && s.svgEntries.length > 0) {
    svgZone.querySelector('.drop-zone-icon').innerHTML = '&#x2705;';
    svgZone.querySelector('.drop-zone-title').textContent = `${s.svgEntries.length} SVGs loaded`;
    svgZone.querySelector('.drop-zone-sub').textContent = 'Drop more to add';
    svgZone.classList.add('done');
  }

  const cssZone = document.getElementById('cssDropZone');
  if (cssZone) {
    if (cssWasApplied) {
      cssZone.querySelector('.drop-zone-icon').innerHTML = '&#x2705;';
      cssZone.querySelector('.drop-zone-title').textContent = 'CSS loaded';
      cssZone.querySelector('.drop-zone-sub').textContent = 'Glyph names applied';
      cssZone.classList.add('done');
    } else if (pendingCssFile) {
      cssZone.querySelector('.drop-zone-icon').innerHTML = '&#x2705;';
      cssZone.querySelector('.drop-zone-title').textContent = pendingCssFile.name;
      cssZone.querySelector('.drop-zone-sub').textContent = 'Ready — will apply when font is loaded';
      cssZone.classList.add('done');
    }
  }

  // Enable/disable start button
  const startBtn = document.getElementById('btnStartMapping');
  if (startBtn) {
    startBtn.disabled = !s.fontFile;
  }
}
