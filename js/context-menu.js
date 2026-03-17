import { getState, notify, defaultTransforms } from './state.js';
import { autoSave } from './persistence.js';
import { addCategory } from './categories.js';
import { collapseAll, expandAll } from './categories.js';
import { collapsedCategories, refreshMappingList } from './render.js';

let activeMenu = null;

/**
 * Initialize context menu listeners.
 * Call once on app startup (not per render).
 */
export function initContextMenu() {
  // Close on click outside
  document.addEventListener('click', () => closeMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // Attach contextmenu to the mapping list via delegation
  document.addEventListener('contextmenu', (e) => {
    const mappingList = document.getElementById('mappingList');
    if (!mappingList) return;

    // Only trigger on rows inside the mapping list
    const row = e.target.closest('.mapping-row, .category-row');
    if (!row || !mappingList.contains(row)) return;

    e.preventDefault();
    const idx = parseInt(row.dataset.idx, 10);
    if (isNaN(idx)) return;

    showMenu(e.clientX, e.clientY, idx);
  });
}

function showMenu(x, y, rowIdx) {
  closeMenu();

  const s = getState();
  const menu = document.getElementById('ctxMenu');
  if (!menu) return;

  const isCategory = s.mappings[rowIdx] && s.mappings[rowIdx].isCategory;
  const selectedCount = s.selectedRows.size;
  const hasMultiSelection = selectedCount > 1;

  let html = '';

  html += `<div class="ctx-menu-item" data-action="add-row-above">Add empty row above</div>`;
  html += `<div class="ctx-menu-item" data-action="add-row-below">Add empty row below</div>`;
  html += `<div class="ctx-menu-item" data-action="add-cat-above">Add category above</div>`;
  html += `<div class="ctx-menu-item" data-action="add-cat-below">Add category below</div>`;
  html += `<div class="ctx-menu-sep"></div>`;
  html += `<div class="ctx-menu-item" data-action="collapse-all">Collapse all</div>`;
  html += `<div class="ctx-menu-item" data-action="expand-all">Expand all</div>`;
  html += `<div class="ctx-menu-sep"></div>`;

  if (hasMultiSelection) {
    html += `<div class="ctx-menu-item danger" data-action="delete-selected">Delete ${selectedCount} selected rows</div>`;
  } else {
    html += `<div class="ctx-menu-item danger" data-action="delete-row">Delete row</div>`;
  }

  menu.innerHTML = html;
  menu.hidden = false;

  // Position, keeping within viewport
  const menuRect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x;
  let top = y;
  if (left + menuRect.width > vw) left = vw - menuRect.width - 4;
  if (top + menuRect.height > vh) top = vh - menuRect.height - 4;
  if (left < 0) left = 4;
  if (top < 0) top = 4;

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  activeMenu = menu;

  // Wire actions (use { once: true } to prevent duplicate handlers)
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-menu-item');
    if (!item) return;

    const action = item.dataset.action;
    handleAction(action, rowIdx);
    closeMenu();
  }, { once: true });

  // Store row index for reference
  menu.dataset.rowIdx = rowIdx;
}

function closeMenu() {
  const menu = document.getElementById('ctxMenu');
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = '';
  }
  activeMenu = null;
}

function getNextCodepoint(mappings) {
  let max = 0xe8ff;
  for (const m of mappings) {
    if (m.isCategory) continue;
    const code = parseInt(m.glyphCodepoint, 16);
    if (!isNaN(code) && code > max) max = code;
  }
  return (max + 1).toString(16);
}

function handleAction(action, rowIdx) {
  const s = getState();

  switch (action) {
    case 'add-row-above': {
      const nextCode = getNextCodepoint(s.mappings);
      s.mappings.splice(rowIdx, 0, {
        glyphName: 'new-icon',
        glyphCodepoint: nextCode,
        svgFilename: null,
        isNew: true,
        transforms: defaultTransforms(),
      });
      autoSave();
      notify();
      break;
    }

    case 'add-row-below': {
      const nextCode = getNextCodepoint(s.mappings);
      s.mappings.splice(rowIdx + 1, 0, {
        glyphName: 'new-icon',
        glyphCodepoint: nextCode,
        svgFilename: null,
        isNew: true,
        transforms: defaultTransforms(),
      });
      autoSave();
      notify();
      break;
    }

    case 'add-cat-above': {
      addCategory(rowIdx - 1, 'New Category');
      break;
    }

    case 'add-cat-below': {
      addCategory(rowIdx, 'New Category');
      break;
    }

    case 'collapse-all': {
      collapseAll(collapsedCategories);
      refreshMappingList();
      break;
    }

    case 'expand-all': {
      expandAll(collapsedCategories);
      refreshMappingList();
      break;
    }

    case 'delete-row': {
      s.mappings.splice(rowIdx, 1);
      s.selectedRows.clear();
      s.lastClickedRow = null;
      autoSave();
      notify();
      break;
    }

    case 'delete-selected': {
      // Delete all selected rows (in reverse order to preserve indices)
      const indices = Array.from(s.selectedRows).sort((a, b) => b - a);
      for (const idx of indices) {
        if (idx >= 0 && idx < s.mappings.length) {
          s.mappings.splice(idx, 1);
        }
      }
      s.selectedRows.clear();
      s.lastClickedRow = null;
      autoSave();
      notify();
      break;
    }
  }
}
