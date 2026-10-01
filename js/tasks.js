import { loadSettings, saveSettings, updateSettings } from './storage.js';
import { playEvent } from './soundEffects.js';
import { animateTriangle, chooseAgent, updateTint, updateTopCharacters } from './charSystem.js';
import { openModal, toast } from './ui.js';

const MAX_TASK_AMOUNT = 20;
let taskGeneration = 0;

// ---------- persistence helpers ----------
function saveTasksArray(tasks) {
  updateSettings(settings => { settings.world.tasks = tasks; });
}

function getPanel() { return document.getElementById('taskPanel'); }
function getTaskList(panel = getPanel()) { return panel?.querySelector('.task-list'); }

// ---------- init panel ----------
export function initTaskPanel(opts = {}) {
  const container = document.getElementById(opts.containerId || 'taskPanel');
  if (!container) return console.warn('taskPanel container not found');

  container.classList.add('task-panel');

  const controls = document.createElement('div');
  controls.className = 'task-controls';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addBtn.className = 'add-task-btn';
  addBtn.title = 'Add task';
  addBtn.setAttribute('aria-label', 'Add task');

  const gateBtn = document.createElement('button');
  gateBtn.type = 'button';
  gateBtn.className = 'task-gate-toggle';
  const gateIcon = document.createElement('span');
  gateIcon.className = 'task-gate-toggle-icon';
  gateIcon.setAttribute('aria-hidden', 'true');
  gateBtn.appendChild(gateIcon);

  const stage = document.createElement('div');
  stage.className = 'task-stage';
  const taskList = document.createElement('div');
  taskList.className = 'task-list';
  const gate = document.createElement('div');
  gate.className = 'task-gate';
  gate.setAttribute('aria-hidden', 'true');
  gate.innerHTML = `
    <span class="task-gate-door task-gate-left"></span>
    <span class="task-gate-door task-gate-right"></span>
    <span class="task-gate-seal">TASKS SECURED</span>`;

  controls.append(addBtn, gateBtn);
  stage.append(taskList, gate);
  container.append(controls, stage);

  // load tasks
  const saved = loadSettings();
  const tasks = Array.isArray(saved?.world?.tasks) ? saved.world.tasks : [];
  container._tasks = tasks;
  tasks.forEach(t => taskList.appendChild(renderTaskCard(t)));

  const setGate = closed => {
    container.classList.toggle('gate-closed', closed);
    gateBtn.title = closed ? 'Open task gate' : 'Close task gate';
    gateBtn.setAttribute('aria-label', gateBtn.title);
    gateBtn.setAttribute('aria-pressed', String(closed));
    taskList.inert = closed;
    if (closed) taskList.setAttribute('aria-hidden', 'true');
    else taskList.removeAttribute('aria-hidden');
  };
  // Every launch starts with the list locked behind the gate. Set before the panel is
  // first drawn, so the doors are simply shut rather than sliding closed.
  setGate(true);

  addBtn.addEventListener('click', () => openTaskForm(taskObj => addTask(taskObj)));
  gateBtn.addEventListener('click', () => setGate(!container.classList.contains('gate-closed')));

  // delegate clicks: pick an agent for that task (deletion handled on its own button)
  container.addEventListener('click', async ev => {
    const card = ev.target.closest('.task');
    if (!card || card.classList.contains('running')) return;
    const task = container._tasks.find(t => t.id === card.dataset.id);
    if (!task) return;
    if (task.mode === 'once' && task.used) {
      toast('That task has already been used.', { kind: 'warn' });
      return;
    }
    const generation = taskGeneration;
    const target = await chooseAgent(`Apply "${task.title}" to…`);
    if (target && generation === taskGeneration) executeTaskOnChar(task, target, card);
  });

  return container;
}

// ---------- new task form ----------
function openTaskForm(onCreate) {
  const form = document.createElement('form');
  form.className = 'task-form';
  form.noValidate = true;
  form.innerHTML = `
    <label class="field">
      <span class="field-label">Title</span>
      <input name="title" type="text" maxlength="40" placeholder="e.g. Contained the anomaly" autocomplete="off" autofocus>
    </label>
    <div class="field">
      <span class="field-label">Effect</span>
      <div class="segmented">
        <label class="seg-merit"><input type="radio" name="type" value="merit" checked><span>&#9650; Merit</span></label>
        <label class="seg-demerit"><input type="radio" name="type" value="demerit"><span>&#9660; Demerit</span></label>
      </div>
    </div>
    <label class="field">
      <span class="field-label">Amount</span>
      <input name="amount" type="number" min="1" max="${MAX_TASK_AMOUNT}" value="1">
    </label>
    <div class="field">
      <span class="field-label">Uses</span>
      <div class="segmented">
        <label><input type="radio" name="mode" value="infinite" checked><span>Repeatable</span></label>
        <label><input type="radio" name="mode" value="once"><span>Once</span></label>
      </div>
    </div>
    <button type="submit" hidden></button>`;

  const titleInput = form.elements.title;
  titleInput.addEventListener('input', () => titleInput.classList.remove('invalid'));

  openModal({
    title: 'New Task',
    content: form,
    className: 'task-modal',
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create Task',
        variant: 'primary',
        submit: true,
        onClick: () => {
          const data = new FormData(form);
          const title = String(data.get('title') || '').trim();
          if (!title) {
            titleInput.classList.remove('invalid');
            void titleInput.offsetWidth;
            titleInput.classList.add('invalid');
            titleInput.focus();
            return false;
          }
          const amount = Math.min(MAX_TASK_AMOUNT, Math.max(1, Number.parseInt(data.get('amount'), 10) || 1));
          onCreate({
            id: 'task-' + Date.now(),
            title,
            type: data.get('type') === 'demerit' ? 'demerit' : 'merit',
            amount,
            used: false,
            mode: data.get('mode') === 'once' ? 'once' : 'infinite'
          });
          return true;
        }
      }
    ]
  });
}

// ---------- Render card ----------
function renderTaskCard(t) {
  const card = document.createElement('div');
  card.className = `task task-${t.type === 'demerit' ? 'demerit' : 'merit'}`;
  card.dataset.id = t.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.title = 'Click to apply to an agent';
  card.addEventListener('keydown', ev => {
    if (ev.target === card && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      card.click();
    }
  });

  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = t.title;

  const metaSpan = document.createElement('span');
  metaSpan.className = 'task-meta';
  metaSpan.textContent = `${t.type === 'merit' ? '▲' : '▼'} +${t.amount} ${t.type === 'merit' ? 'merit' : 'demerit'} · ${t.mode === 'once' ? 'once' : '∞'}`;

  const delBtn = document.createElement('button');
  delBtn.className = 'task-del';
  delBtn.title = 'Delete task';
  delBtn.type = 'button';
  delBtn.textContent = '×';

  // deletion handler (stop propagation so clicking X doesn't open the chooser)
  delBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    deleteTaskById(t.id);
  });

  card.append(titleSpan, metaSpan, delBtn);

  if (t.mode === 'once' && t.used) card.classList.add('used');
  return card;
}

// ---------- delete task ----------
export function deleteTaskById(id) {
  const panel = getPanel();
  if (!panel || !panel._tasks) return;
  panel._tasks = panel._tasks.filter(t => t.id !== id);
  saveTasksArray(panel._tasks);

  const card = panel.querySelector(`.task[data-id="${id}"]`);
  if (!card) return;
  card.classList.add('leaving');
  const detach = () => card.remove();
  card.addEventListener('animationend', detach, { once: true });
  setTimeout(detach, 400);
}

// ---------- reset tasks ----------
export function resetTasks() {
  taskGeneration++;
  const panel = getPanel();
  if (!panel) return;
  getTaskList(panel)?.replaceChildren();
  panel._tasks = [];
  saveTasksArray([]);
}

// ---------- execution ----------
function executeTaskOnChar(task, charEl, card) {
  const generation = taskGeneration;
  const times = Math.max(1, Number(task.amount || 1));
  const isMerit = task.type === 'merit';
  const triangle = isMerit ? charEl.querySelector('.triangle') : charEl.querySelector('.triangle-down');
  if (!triangle) return;

  card?.classList.add('running');

  let i = 0;
  const step = () => {
    // A mission reset cancels points still queued by an animated task.
    if (generation !== taskGeneration) return;
    const n = parseInt(triangle.textContent) || 0;
    triangle.textContent = n + 1;
    animateTriangle(triangle);
    playEvent(isMerit ? 'merit' : 'demerit');
    updateTint(charEl);
    i++;
    if (i < times) {
      setTimeout(step, 120);
      return;
    }

    saveSettings();
    updateTopCharacters();
    card?.classList.remove('running');

    // Sample the graph only after every point in a multi-point task has been
    // applied; sampling before completion left the timeline one or more points behind.
    document.dispatchEvent(new CustomEvent('task-executed', { detail: { task, charEl } }));

    if (task.mode === 'once') {
      task.used = true;
      const panel = getPanel();
      if (panel) {
        panel._tasks = panel._tasks.map(t => (t.id === task.id ? task : t));
        panel.querySelector(`.task[data-id="${task.id}"]`)?.classList.add('used');
        saveTasksArray(panel._tasks);
      }
    }
  };
  step();
}

// ---------- add task (used by the form, also exported for external usage) ----------
export function addTask(taskObj) {
  const panel = getPanel();
  if (!panel) return;
  panel._tasks = panel._tasks || [];
  panel._tasks.push(taskObj);
  saveTasksArray(panel._tasks);
  const card = renderTaskCard(taskObj);
  card.classList.add('entering');
  card.addEventListener('animationend', () => card.classList.remove('entering'), { once: true });
  getTaskList(panel)?.appendChild(card);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
