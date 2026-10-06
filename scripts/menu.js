const MODULE_ID = "sheet-header-menu";
const HIDDEN = "shm-hidden-control";
const states = new WeakMap();
const activeStates = new Set();

// Имена стандартных действий Foundry и дополнительных действий системы PF2e.
const BASE_CONTROLS = new Set([
  "close", "configure-sheet", "configure-token", "configure-creature", "import",
  "show-sheet", "refresh-from-compendium", "configureSheet", "configureToken",
  "configurePrototypeToken", "importDocument", "showPortraitArtwork", "showTokenArtwork",
  "toggleControls", "minimize", "maximize", "detach", "attach"
]);

function isSheet(app) {
  const doc = app.document ?? app.actor ?? app.item;
  return ["Actor", "Item"].includes(doc?.documentName)
    && (typeof app._getHeaderButtons === "function" || typeof app._getHeaderControls === "function");
}

function isBase(node) {
  const extra = game.settings.get(MODULE_ID, "keepVisible").split(/[\s,;]+/).filter(Boolean);
  return [...BASE_CONTROLS, ...extra].some(key => node.classList.contains(key) || node.dataset.action === key);
}

function labelFor(node) {
  const text = node.textContent.trim();
  const label = text || node.getAttribute("aria-label") || node.dataset.tooltip || node.title;
  return game.i18n.localize(label || "Дополнительное действие");
}

function available(node) {
  if (node.hidden || node.classList.contains("hidden") || node.style.display === "none") return false;
  // Наш класс скрывает оригинал, но не должен скрывать пункт меню.
  const win = node.ownerDocument.defaultView;
  if (!node.classList.contains(HIDDEN) && win.getComputedStyle(node).display === "none") return false;
  return true;
}

function closeMenu(state, focus = false) {
  if (!state.menu) return;
  state.menu.remove();
  state.menu = null;
  state.menuEvents?.abort();
  state.menuEvents = null;
  state.toggle.setAttribute("aria-expanded", "false");
  if (focus && state.toggle.isConnected) state.toggle.focus();
}

function positionMenu(state) {
  if (!state.menu) return;
  const rect = state.toggle.getBoundingClientRect();
  const menu = state.menu;
  const win = state.root.ownerDocument.defaultView;
  const width = menu.getBoundingClientRect().width;
  const height = menu.getBoundingClientRect().height;
  const left = Math.max(8, Math.min(rect.right - width, win.innerWidth - width - 8));
  const top = rect.bottom + height + 8 <= win.innerHeight
    ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const z = Number.parseInt(win.getComputedStyle(state.root).zIndex, 10) || 100;
  menu.style.zIndex = String(Math.max(z + 1, 10000));
}

function openMenu(state) {
  if (state.menu) return closeMenu(state);
  for (const other of activeStates) closeMenu(other);
  const doc = state.root.ownerDocument;
  const win = doc.defaultView;
  const menu = doc.createElement("div");
  menu.className = "shm-menu";
  menu.id = state.menuId;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Кнопки модулей");
  for (const original of state.controls) {
    if (!original.isConnected || !available(original)) continue;
    const entry = doc.createElement("button");
    entry.type = "button";
    entry.className = "shm-menu-entry";
    entry.setAttribute("role", "menuitem");
    entry.disabled = original.disabled === true || original.getAttribute("aria-disabled") === "true"
      || original.classList.contains("disabled");
    const icon = original.querySelector("i, svg, img")?.cloneNode(true);
    if (icon) { icon.setAttribute("aria-hidden", "true"); entry.append(icon); }
    const label = doc.createElement("span");
    label.textContent = labelFor(original);
    entry.append(label);
    entry.addEventListener("click", event => {
      closeMenu(state, true);
      if (!original.isConnected || entry.disabled) return;
      // Оригинал остаётся в заголовке: сохраняются его обработчики, данные и всплытие события.
      original.dispatchEvent(new win.MouseEvent("click", {
        bubbles: true, cancelable: true, view: win, button: 0,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
        altKey: event.altKey, metaKey: event.metaKey,
        clientX: event.clientX, clientY: event.clientY
      }));
    });
    menu.append(entry);
  }
  if (!menu.children.length) return;
  state.menu = menu;
  doc.body.append(menu);
  state.toggle.setAttribute("aria-expanded", "true");
  positionMenu(state);
  const controller = new win.AbortController();
  state.menuEvents = controller;
  const options = { signal: controller.signal };
  doc.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target) && !state.toggle.contains(event.target)) closeMenu(state);
  }, { ...options, capture: true });
  doc.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); closeMenu(state, true);
    } else if (event.key === "Tab") closeMenu(state);
  }, { ...options, capture: true });
  menu.addEventListener("keydown", event => {
    const entries = [...menu.querySelectorAll("button:not(:disabled)")];
    const current = entries.indexOf(doc.activeElement);
    let next;
    if (event.key === "ArrowDown") next = (current + 1) % entries.length;
    else if (event.key === "ArrowUp") next = (current - 1 + entries.length) % entries.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    if (next !== undefined && entries.length) { event.preventDefault(); entries[next].focus(); }
  });
  win.addEventListener("resize", () => positionMenu(state), options);
  doc.addEventListener("scroll", event => {
    if (!menu.contains(event.target)) closeMenu(state);
  }, { ...options, capture: true });
  menu.querySelector("button:not(:disabled)")?.focus();
}

function refresh(state) {
  if (!state.root.isConnected) return destroy(state);
  if (state.root.classList.contains("minimized")) closeMenu(state);
  const controls = [...state.header.querySelectorAll(":scope > a, :scope > button")]
    .filter(node => node !== state.toggle && !isBase(node) && available(node));
  for (const old of state.controls) {
    if (!controls.includes(old)) old.classList.remove(HIDDEN);
  }
  for (const node of controls) {
    if (!node.classList.contains(HIDDEN)) node.classList.add(HIDDEN);
  }
  const changed = controls.length !== state.controls.length
    || controls.some((node, index) => node !== state.controls[index]);
  state.controls = controls;
  if (state.toggle.hidden !== !controls.length) state.toggle.hidden = !controls.length;
  if (changed) closeMenu(state);
  positionMenu(state);
}

function destroy(state) {
  closeMenu(state);
  state.observer.disconnect();
  state.rootObserver.disconnect();
  for (const node of state.controls) node.classList.remove(HIDDEN);
  state.toggle.remove();
  states.delete(state.app);
  activeStates.delete(state);
}

function organize(app, html) {
  if (!isSheet(app)) return;
  const root = html?.nodeType === 1 ? html : html?.[0] ?? app.element?.[0] ?? app.element;
  const header = root?.querySelector(":scope > .window-header");
  if (!header) return;
  let state = states.get(app);
  if (state?.header === header) { refresh(state); return; }
  if (state) destroy(state);
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shm-toggle";
  toggle.innerHTML = '<i class="fa-solid fa-puzzle-piece" aria-hidden="true"></i><span>Модули</span><i class="fa-solid fa-caret-down" aria-hidden="true"></i>';
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  const menuId = `shm-menu-${app.appId ?? app.id}`;
  toggle.setAttribute("aria-controls", menuId);
  toggle.title = "Дополнительные кнопки модулей";
  toggle.hidden = true;
  const close = header.querySelector(":scope > .close, :scope > [data-action='close']");
  header.insertBefore(toggle, close);
  state = { app, root, header, toggle, menuId, controls: [], menu: null };
  states.set(app, state);
  activeStates.add(state);
  toggle.addEventListener("pointerdown", event => event.stopPropagation());
  toggle.addEventListener("mousedown", event => event.stopPropagation());
  toggle.addEventListener("dblclick", event => event.stopPropagation());
  toggle.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation(); openMenu(state);
  });
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    win.requestAnimationFrame(() => {
      pending = false;
      if (states.get(app) === state) refresh(state);
    });
  };
  state.observer = new win.MutationObserver(schedule);
  state.observer.observe(header, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["class", "hidden", "disabled", "aria-disabled", "data-action", "style"] });
  state.rootObserver = new win.MutationObserver(schedule);
  state.rootObserver.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
  refresh(state);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "keepVisible", {
    name: "Оставить дополнительные кнопки снаружи",
    hint: "Имена классов или действий кнопок через запятую. Пустое поле — только базовые кнопки. Настройка действует для вашего пользователя.",
    scope: "client", config: true, type: String, default: "",
    onChange: () => { for (const state of activeStates) refresh(state); }
  });
});

Hooks.once("ready", () => {
  const render = (app, html) => {
    // Дождаться остальных обработчиков от систем и модулей.
    setTimeout(() => organize(app, html), 0);
  };
  for (const name of ["renderApplication", "renderApplicationV1", "renderApplicationV2"]) Hooks.on(name, render);
  for (const name of ["closeApplication", "closeApplicationV1", "closeApplicationV2"]) {
    Hooks.on(name, app => { const state = states.get(app); if (state) destroy(state); });
  }
  for (const app of Object.values(ui.windows ?? {})) organize(app, app.element);
});
