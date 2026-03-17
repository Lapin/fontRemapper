import { getState, notify, defaultTransforms } from './state.js';
import { autoSave } from './persistence.js';
import { addCategory } from './categories.js';
import { collapseAll, expandAll } from './categories.js';
import { collapsedCategories, refreshMappingList } from './render.js';

let activeMenu = null;

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
  const oldMenu = document.getElementById('ctxMenu');
  if (!oldMenu) return;

  // Clone to strip ALL old event listeners
  const menu = oldMenu.cloneNode(false);
  oldMenu.parentNode.replaceChild(menu, oldMenu);
  menu.id = 'ctxMenu';

  const selectedCount = s.selectedRows.size;
  const hasMultiSelection = selectedCount > 1;

  // Gather categories for "Move to" submenu
  const categories = [];
  for (let i = 0; i < s.mappings.length; i++) {
    if (s.mappings[i].isCategory) {
      categories.push({ idx: i, name: s.mappings[i].categoryName, _id: s.mappings[i]._id });
    }
  }

  let html = '';

  // "Move to" submenu — top of menu
  if (categories.length > 0) {
    html += `<div class="ctx-menu-item ctx-submenu-parent">Move to &#9656;
      <div class="ctx-submenu">`;
    for (const cat of categories) {
      html += `<div class="ctx-menu-item" data-action="move-to-cat" data-cat-id="${escHtml(cat._id)}">${escHtml(cat.name)}</div>`;
    }
    html += `</div></div>`;
  } else {
    html += `<div class="ctx-menu-item disabled">Move to (no categories)</div>`;
  }

  html += `<div class="ctx-menu-sep"></div>`;
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

  // Wire each item directly — no container listener accumulation
  menu.querySelectorAll('.ctx-menu-item[data-action]').forEach(item => {
    // Skip parent items that only contain a submenu
    if (item.classList.contains('ctx-submenu-parent')) return;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const catId = item.dataset.catId || null;
      closeMenu();
      handleAction(action, rowIdx, catId);
    }, { once: true });
  });
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

function handleAction(action, rowIdx, catId) {
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

    case 'move-to-cat': {
      if (!catId) break;
      // Collect rows to move: selected rows or just the right-clicked row
      let indicesToMove;
      if (s.selectedRows.size > 0 && s.selectedRows.has(rowIdx)) {
        indicesToMove = Array.from(s.selectedRows).sort((a, b) => a - b);
      } else {
        indicesToMove = [rowIdx];
      }
      // Don't move categories
      indicesToMove = indicesToMove.filter(i => s.mappings[i] && !s.mappings[i].isCategory);
      if (indicesToMove.length === 0) break;

      // Extract items
      const items = indicesToMove.map(i => s.mappings[i]);

      // Remove from current positions (reverse order to preserve indices)
      for (let i = indicesToMove.length - 1; i >= 0; i--) {
        s.mappings.splice(indicesToMove[i], 1);
      }

      // Find the target category by _id (stable after removals)
      let targetCatIdx = s.mappings.findIndex(m => m.isCategory && m._id === catId);
      if (targetCatIdx === -1) break;

      // Find the end of the target category section
      let insertIdx = targetCatIdx + 1;
      while (insertIdx < s.mappings.length && !s.mappings[insertIdx].isCategory) {
        insertIdx++;
      }

      // Insert items at the end of the target category section
      s.mappings.splice(insertIdx, 0, ...items);

      s.selectedRows.clear();
      s.lastClickedRow = null;
      autoSave();
      notify();
      break;
    }
  }
}
