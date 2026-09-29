// ui.js
// Shared in-app UI: toast notifications and modal dialogs (replaces alert/prompt/confirm).

let toastStack = null;

function ensureToastStack() {
  if (toastStack) return toastStack;
  toastStack = document.createElement('div');
  toastStack.className = 'toast-stack';
  toastStack.setAttribute('role', 'status');
  toastStack.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastStack);
  return toastStack;
}

function dismissToast(el) {
  if (!el || el.classList.contains('leaving')) return;
  el.classList.add('leaving');
  const remove = () => el.remove();
  el.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 400);
}

/**
 * toast - show a short, self-dismissing message.
 * kind: 'info' | 'warn' | 'error'; action: optional { label, onClick }.
 */
export function toast(message, { kind = 'info', duration = 3200, action } = {}) {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;

  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.onClick();
      dismissToast(el);
    });
    el.appendChild(btn);
  }

  stack.appendChild(el);
  setTimeout(() => dismissToast(el), duration);
  return el;
}

/**
 * openModal - show a dialog with arbitrary content and action buttons.
 * Each action: { label, variant: 'primary' | 'danger' | undefined, onClick, submit }.
 * An onClick that returns false keeps the modal open. The action flagged
 * `submit` also runs when a <form> inside the content is submitted (Enter).
 * onClose runs however the modal is dismissed. Returns a close() function.
 */
export function openModal({ title, content, actions = [], className = '', onClose }) {
  const previousFocus = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const panel = document.createElement('div');
  panel.className = `modal-panel ${className}`.trim();
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);

  const heading = document.createElement('h2');
  heading.className = 'modal-title';
  heading.textContent = title;
  panel.appendChild(heading);

  if (content) panel.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'modal-actions';

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('leaving');
    const remove = () => backdrop.remove();
    backdrop.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 300);
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    onClose?.();
  }

  function run(action) {
    if (action.onClick?.() === false) return;
    close();
  }

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `modal-btn ${action.variant ? `modal-btn-${action.variant}` : ''}`.trim();
    btn.textContent = action.label;
    btn.addEventListener('click', () => run(action));
    footer.appendChild(btn);
  });
  panel.appendChild(footer);

  const submitAction = actions.find(action => action.submit);
  panel.querySelector('form')?.addEventListener('submit', event => {
    event.preventDefault();
    if (submitAction) run(submitAction);
  });

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close(); });

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  requestAnimationFrame(() => {
    const focusTarget = panel.querySelector('[autofocus], input, textarea, .chooser-item, .modal-btn-primary, .modal-btn');
    focusTarget?.focus();
  });

  return close;
}

/** confirmDialog - promise-based replacement for window.confirm. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const body = document.createElement('p');
    body.className = 'modal-message';
    body.textContent = message;
    let confirmed = false;
    openModal({
      title,
      content: body,
      actions: [
        { label: 'Cancel' },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { confirmed = true; } }
      ],
      // Escape, backdrop click and Cancel all resolve false.
      onClose: () => resolve(confirmed)
    });
  });
}
