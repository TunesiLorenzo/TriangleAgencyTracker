// tasks.js
import { loadSettings } from './storage.js';
import { saveSettings } from './storage.js';
import { playSfx } from './soundEffects.js';
import { animateTriangle, updateTint, updateTopCharacters } from './charSystem.js';

// ---------- persistence helpers ----------
function readSaved() { return loadSettings() || { chars: [], world: { branchName:'', witness:0, chaos:0 } }; }
function writeSaved(obj) { try { localStorage.setItem('rpgSettings', JSON.stringify(obj)); } catch(e){ console.error(e); } }
function saveTasksArray(tasks){ const s = readSaved(); s.world = s.world || {}; s.world.tasks = tasks; writeSaved(s); }

// ---------- init panel ----------
export function initTaskPanel(opts = {}) {
  const container = document.getElementById(opts.containerId || 'taskPanel');
  if (!container) return console.warn('taskPanel container not found');

  container.classList.add('task-panel');

  // Add "Add Task" button (kept as first child)
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add Task';
  addBtn.className = 'add-task-btn';
  container.appendChild(addBtn);

  // load tasks
  const saved = readSaved();
  const tasks = (saved?.world?.tasks && Array.isArray(saved.world.tasks)) ? saved.world.tasks : [];
  container._tasks = tasks;

  // render existing tasks
  tasks.forEach(t => container.appendChild(renderTaskCard(t)));

  // create chooser (single reused element)
  const chooser = createChooser();
  document.body.appendChild(chooser);

  // add task flow
  addBtn.addEventListener('click', () => {
    const title = prompt('Task title:'); if (!title) return;
    const type = prompt('Type: merit or demerit', 'merit').toLowerCase();
    if (type !== 'merit' && type !== 'demerit') return alert('Type must be merit or demerit');
    const amount = parseInt(prompt('Amount (number of triangles to apply)', '1')) || 1;
    const mode = prompt('Mode: once or infinite', 'infinite').toLowerCase();
    const taskObj = {
      id: 'task-' + Date.now(),
      title,
      type,
      amount,
      used: false,
      mode: (mode === 'once' ? 'once' : 'infinite'),
      icon: type === 'merit' ? '👍' : '👎'
    };
    container._tasks.push(taskObj);
    saveTasksArray(container._tasks);
    container.appendChild(renderTaskCard(taskObj));
  });

  // delegate clicks: open chooser for that task (but deletion handled on button)
  container.addEventListener('click', ev => {
    const card = ev.target.closest('.task');
    if (!card) return;
    // if the click was on the delete button it would have been handled by its own listener
    const task = container._tasks.find(t => t.id === card.dataset.id);
    if (!task) return;
    if (task.mode === 'once' && task.used) return; // inactive
    openChooser(chooser, task, (charIndex) => {
      const chars = [...document.querySelectorAll('.char')];
      const target = chars[charIndex];
      if (!target) return;
      executeTaskOnChar(task, target, container);
    });
  });

  return container;
}

// ---------- Render card (now creates elements so delete button can have its own listener) ----------
function renderTaskCard(t) {
  const card = document.createElement('div');
  card.className = 'task';
  card.dataset.id = t.id;

  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = t.title;

  const metaSpan = document.createElement('span');
  metaSpan.className = 'task-meta';
  metaSpan.textContent = `+${t.amount} ${t.type === 'merit' ? 'merit' : 'demerit'}`;

  const delBtn = document.createElement('button');
  delBtn.className = 'task-del';
  delBtn.title = 'Delete task';
  delBtn.type = 'button';
  delBtn.textContent = '✖';

  // deletion handler (stop propagation so clicking X doesn't open chooser)
  delBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    deleteTaskById(t.id);
  });

  card.append(titleSpan, metaSpan, delBtn);

  if (t.mode === 'once' && t.used) {
    card.classList.add('used');
  }
  return card;
}

// ---------- delete task ----------
export function deleteTaskById(id) {
  const panel = document.getElementById('taskPanel');
  if (!panel || !panel._tasks) return;
  panel._tasks = panel._tasks.filter(t => t.id !== id);
  // remove DOM node
  const card = panel.querySelector(`.task[data-id="${id}"]`);
  if (card) card.remove();
  // persist
  saveTasksArray(panel._tasks);
}

// ---------- reset tasks ----------
export function resetTasks() {
  const panel = document.getElementById('taskPanel');
  if (!panel) return;
  // keep the add button (first child) if present, remove others
  const addBtn = panel.querySelector('.add-task-btn');
  panel.innerHTML = '';
  if (addBtn) panel.appendChild(addBtn);
  panel._tasks = [];
  saveTasksArray([]);
}

// ---------- chooser UI ----------
function createChooser() {
  const wrap = document.createElement('div');
  wrap.className = 'task-chooser hidden';
  wrap.innerHTML = `
    <div class="chooser-panel" role="dialog" aria-modal="true" aria-label="Choose character">
      <div class="chooser-title">Choose character</div>
      <div class="chooser-list"></div>
      <div class="chooser-footer"><button class="chooser-cancel">Cancel</button></div>
    </div>`;
  wrap.querySelector('.chooser-cancel').addEventListener('click', () => closeChooser(wrap));
  wrap.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeChooser(wrap); });
  return wrap;
}

function openChooser(chooser, task, cb) {
  const list = chooser.querySelector('.chooser-list');
  list.innerHTML = '';
  const chars = [...document.querySelectorAll('.char')];
  if (!chars.length) {
    list.innerHTML = '<div class="chooser-empty">No characters available</div>';
  } else {
    chars.forEach((c, i) => {
      const name = c.querySelector('.stat input')?.value || `Char ${i+1}`;
      const img = c.querySelector('img')?.src || '';
      const btn = document.createElement('button');
      btn.className = 'chooser-item';
      btn.innerHTML = `<img src="${img}" alt="" aria-hidden="true"><span>${escapeHtml(name)}</span>`;
      btn.addEventListener('click', () => { cb(i); closeChooser(chooser); });
      list.appendChild(btn);
    });
  }
  chooser.classList.remove('hidden');
  setTimeout(() => {
    const first = chooser.querySelector('.chooser-item');
    if (first) first.focus();
    chooser.focus();
  }, 0);
}
function closeChooser(chooser) { chooser.classList.add('hidden'); }

// ---------- execution ----------
function executeTaskOnChar(task, charEl, panelEl) {
  const times = Math.max(1, Number(task.amount || 1));
  const isMerit = task.type === 'merit';
  const triangle = isMerit ? charEl.querySelector('.triangle') : charEl.querySelector('.triangle-down');
  if (!triangle) return;

  let i = 0;
  const step = () => {
    const n = parseInt(triangle.textContent) || 0;
    triangle.textContent = n + 1;
    animateTriangle(triangle);
    playSfx(isMerit ? 'audio/merit.mp3' : 'audio/demerit.mp3');
    updateTint(charEl);
    i++;
    if (i < times) setTimeout(step, 120);
    else {
      saveSettings();
      updateTopCharacters();

      if (task.mode === 'once') {
        task.used = true;
        const panel = document.getElementById('taskPanel');
        if (panel) {
          panel._tasks = panel._tasks.map(t => (t.id === task.id ? task : t));
          const card = panel.querySelector(`.task[data-id="${task.id}"]`);
          if (card) card.classList.add('used');
          saveTasksArray(panel._tasks);
        }
      }
    }
  };
  step();

  document.dispatchEvent(new CustomEvent('task-executed', { detail: { task, charEl } }));
}

// ---------- helpers ----------
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---------- convenience export for external usage ----------
export function addTask(taskObj) {
  const panel = document.getElementById('taskPanel');
  if (!panel) return;
  panel._tasks = panel._tasks || [];
  panel._tasks.push(taskObj);
  saveTasksArray(panel._tasks);
  panel.appendChild(renderTaskCard(taskObj));
}
