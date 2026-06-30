// ═══════════════════════════════════════════════════════════════
// LifeSaver AI — Productivity Companion
// ═══════════════════════════════════════════════════════════════

const GEMINI_API_KEY = 'AQ.Ab8RN6L927E1hzMQFu6T1agKaUjiHsfDxRD21yCdZ7qoHaaDvg';
const STORAGE_KEY = 'lifesaver_state';
const MOOD_KEY = 'lifesaver_mood_date';

// ─── Level Definitions ───
const LEVELS = [
  { name: 'Procrastinator', minXP: 0 },
  { name: 'Starter',        minXP: 50 },
  { name: 'Achiever',       minXP: 150 },
  { name: 'Focused',        minXP: 300 },
  { name: 'Productive',     minXP: 500 },
  { name: 'Master',         minXP: 800 },
  { name: 'Legend',         minXP: 1200 },
];

const MOOD_LABELS = ['', 'Exhausted', 'Low Energy', 'Okay', 'Good', 'On Fire'];
const MOOD_EMOJIS = ['', '😴', '😔', '😐', '😊', '🔥'];

const PRIORITY_SCORES = { critical: 80, high: 60, medium: 40, low: 20 };

// ─── Global State ───
let state = {
  tasks: [],
  habits: [],
  xp: 0,
  mood: null,
  energy: null,
  contracts: [],
  chatHistory: [],
  dayStreak: 0,
  schedule: [],
  lastActiveDate: null,
};

let currentFilter = 'all';
let deathClockInterval = null;
let recognition = null;

// ─── Utility Helpers ───
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return document.querySelectorAll(sel);
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function hoursUntil(dueISO) {
  return (new Date(dueISO) - Date.now()) / 3600000;
}

function isOverdue(task) {
  return !task.done && new Date(task.due) < new Date();
}

function todayKey() {
  return new Date().toDateString();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Persistence ───
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
      return;
    }
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
  seedDemoData();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

function seedDemoData() {
  const now = Date.now();
  const h = (n) => new Date(now + n * 3600000).toISOString();
  const d = (n) => new Date(now - n * 3600000).toISOString();

  state.tasks = [
    { id: uid(), name: 'Finish quarterly report', priority: 'critical', due: h(3), cat: 'work', done: false, effort: 4, created: h(-48) },
    { id: uid(), name: 'Review pull requests', priority: 'high', due: h(8), cat: 'work', done: false, effort: 2, created: h(-24) },
    { id: uid(), name: 'Grocery shopping', priority: 'medium', due: h(20), cat: 'personal', done: false, effort: 2, created: h(-12) },
    { id: uid(), name: 'Morning workout', priority: 'high', due: h(1), cat: 'health', done: false, effort: 3, created: h(-6) },
    { id: uid(), name: 'Read chapter 5', priority: 'low', due: h(48), cat: 'learning', done: false, effort: 2, created: h(-72) },
    { id: uid(), name: 'Pay utility bills', priority: 'critical', due: d(2), cat: 'personal', done: false, effort: 1, created: h(-96) },
    { id: uid(), name: 'Team standup notes', priority: 'medium', due: h(5), cat: 'work', done: true, effort: 1, created: h(-8) },
  ];

  state.habits = [
    { id: uid(), name: 'Morning meditation', streak: 5, history: [true, true, true, false, true, true, true], todayDone: false },
    { id: uid(), name: 'Drink 8 glasses of water', streak: 12, history: [true, true, true, true, true, true, true], todayDone: true },
    { id: uid(), name: 'No social media before noon', streak: 3, history: [false, true, true, false, true, true, false], todayDone: false },
  ];

  state.xp = 85;
  state.dayStreak = 4;
  state.contracts = [
    { id: uid(), task: 'Ship MVP by Friday', consequence: 'Donate $50 to charity', deadline: h(72), signed: new Date().toISOString() },
  ];
  state.chatHistory = [
    { role: 'assistant', text: 'Hey! I\'m LifeSaver, your AI productivity companion. Ask me to help plan your day, prioritize tasks, or stay accountable!' },
  ];
  state.lastActiveDate = todayKey();
  saveState();
}

// ─── Scoring Engine ───
function computeScore(task) {
  let score = PRIORITY_SCORES[task.priority] || 40;
  const hrs = hoursUntil(task.due);

  if (hrs < 0) score += 30;
  else if (hrs < 2) score += 20;
  else if (hrs < 6) score += 10;
  else if (hrs < 24) score += 5;

  return score;
}

function getSortedTasks(tasks) {
  let list = [...tasks];
  if (state.energy !== null && state.energy <= 2) {
    list.sort((a, b) => a.effort - b.effort || computeScore(b) - computeScore(a));
  } else {
    list.sort((a, b) => computeScore(b) - computeScore(a));
  }
  return list;
}

// ─── XP & Level System ───
function getLevel() {
  let level = LEVELS[0];
  for (const l of LEVELS) {
    if (state.xp >= l.minXP) level = l;
  }
  return level;
}

function getNextLevel() {
  const current = getLevel();
  const idx = LEVELS.indexOf(current);
  return idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
}

function addXP(amount, reason) {
  state.xp = Math.max(0, state.xp + amount);
  saveState();
  renderXP();

  const sign = amount >= 0 ? '+' : '';
  showToast(`${sign}${amount} XP — ${reason}`, amount >= 0 ? 'xp-positive' : 'xp-negative');
  showFloatingXP(amount);

  const prevLevel = getLevel();
  renderXP();
  const newLevel = getLevel();
  if (newLevel.name !== prevLevel.name && amount > 0) {
    showToast(`🎉 Level up! You're now a ${newLevel.name}!`, 'xp-positive');
  }
}

function renderXP() {
  const level = getLevel();
  const next = getNextLevel();
  const fill = next
    ? ((state.xp - level.minXP) / (next.minXP - level.minXP)) * 100
    : 100;

  $('#level-name').textContent = level.name;
  $('#xp-fill').style.width = `${Math.min(100, fill)}%`;
  $('#xp-text').textContent = `${state.xp} XP`;
  $('#day-streak').textContent = `${state.dayStreak} day streak`;
}

function calcTaskXP(task) {
  const hrs = hoursUntil(task.due);
  if (hrs < 0) return -10;
  if (hrs < 2) return 25;
  if (hrs < 6) return 15;
  if (hrs < 24) return 10;
  return 5;
}

// ─── Toast & Floating XP ───
function showToast(message, className = '') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${className}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showFloatingXP(amount) {
  const container = $('#xp-float-container');
  const el = document.createElement('div');
  el.className = `xp-float ${amount >= 0 ? 'positive' : 'negative'}`;
  el.textContent = `${amount >= 0 ? '+' : ''}${amount} XP`;
  el.style.left = `${40 + Math.random() * 20}%`;
  el.style.top = `${50 + Math.random() * 10}%`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ─── View Routing ───
const VIEW_TITLES = {
  dashboard: 'Dashboard',
  tasks: 'Tasks',
  schedule: 'Schedule',
  habits: 'Habits',
  analytics: 'Analytics',
  chat: 'AI Chat',
};

function switchView(viewName) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $$('.nav-item').forEach((n) => n.classList.remove('active'));

  const view = $(`#view-${viewName}`);
  const nav = $(`.nav-item[data-view="${viewName}"]`);
  if (view) view.classList.add('active');
  if (nav) nav.classList.add('active');

  $('#view-title').textContent = VIEW_TITLES[viewName] || viewName;

  if (window.innerWidth <= 600) {
    $('#sidebar').classList.remove('open');
  }

  if (viewName === 'analytics') renderAnalytics();
  if (viewName === 'chat') renderChat();
  if (viewName === 'schedule') renderSchedule();
}

function initNavigation() {
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('#sidebar-toggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
  });

  $('#sidebar-close').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
  });

  $('#crisis-action').addEventListener('click', () => switchView('tasks'));
}

// ─── Crisis Banner ───
function updateCrisisBanner() {
  const overdue = state.tasks.filter((t) => isOverdue(t));
  const banner = $('#crisis-banner');

  if (overdue.length > 0) {
    banner.classList.remove('hidden');
    $('#crisis-text').textContent =
      `🚨 ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}! Act now to avoid penalties.`;
  } else {
    banner.classList.add('hidden');
  }
}

// ─── Task CRUD ───
function createTask(data) {
  const task = {
    id: uid(),
    name: data.name,
    priority: data.priority,
    due: data.due,
    cat: data.cat,
    done: false,
    effort: data.effort,
    created: new Date().toISOString(),
  };
  state.tasks.push(task);
  saveState();
  addXP(5, 'New task created');
  renderAll();
  return task;
}

function updateTask(id, data) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  Object.assign(task, data);
  saveState();
  renderAll();
}

function toggleTaskDone(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;

  task.done = !task.done;
  if (task.done) {
    const xp = calcTaskXP(task);
    addXP(xp, xp > 0 ? 'Task completed early!' : 'Late completion penalty');
  }
  saveState();
  renderAll();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  saveState();
  renderAll();
}

function renderTaskItem(task, { compact = false, showActions = true } = {}) {
  const score = computeScore(task);
  const overdue = isOverdue(task);
  const el = document.createElement('div');
  el.className = `task-item${task.done ? ' done' : ''}${overdue ? ' overdue-item' : ''}`;
  el.innerHTML = `
    <input type="checkbox" class="task-checkbox" ${task.done ? 'checked' : ''} data-id="${task.id}">
    <div class="task-info">
      <div class="task-name">${escapeHtml(task.name)}</div>
      <div class="task-meta">
        <span class="task-score">${score} pts</span>
        <span class="priority-badge priority-${task.priority}">${task.priority}</span>
        <span class="cat-badge">${task.cat}</span>
        <span class="cat-badge">⚡ ${task.effort}</span>
        <span class="cat-badge">${formatDateTime(task.due)}</span>
      </div>
    </div>
    ${showActions ? `
    <div class="task-actions">
      <button class="edit-btn" data-id="${task.id}" title="Edit">✏️</button>
      <button class="delete-btn" data-id="${task.id}" title="Delete">🗑️</button>
    </div>` : ''}
  `;

  el.querySelector('.task-checkbox').addEventListener('change', () => toggleTaskDone(task.id));
  if (showActions) {
    el.querySelector('.edit-btn').addEventListener('click', () => openTaskForm(task.id));
    el.querySelector('.delete-btn').addEventListener('click', () => {
      if (confirm('Delete this task?')) deleteTask(task.id);
    });
  }
  return el;
}

function filterTasks(tasks) {
  switch (currentFilter) {
    case 'pending': return tasks.filter((t) => !t.done);
    case 'done': return tasks.filter((t) => t.done);
    case 'overdue': return tasks.filter((t) => isOverdue(t));
    default: return tasks;
  }
}

function renderTasks() {
  const list = $('#tasks-list');
  list.innerHTML = '';
  const filtered = filterTasks(state.tasks);
  const sorted = getSortedTasks(filtered);

  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty-state">No tasks found. Add one to get started!</div>';
    return;
  }

  sorted.forEach((task) => list.appendChild(renderTaskItem(task)));
}

function renderDashboardTasks() {
  const container = $('#dashboard-tasks');
  container.innerHTML = '';
  const pending = getSortedTasks(state.tasks.filter((t) => !t.done)).slice(0, 5);

  $('#task-count-badge').textContent = `${state.tasks.filter((t) => !t.done).length} tasks`;

  if (pending.length === 0) {
    container.innerHTML = '<div class="empty-state">All caught up! 🎉</div>';
    return;
  }

  pending.forEach((task) => container.appendChild(renderTaskItem(task, { compact: true, showActions: false })));
}

function openTaskForm(taskId = null) {
  const panel = $('#task-form-panel');
  const form = $('#task-form');
  form.reset();

  if (taskId) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    $('#task-form-title').textContent = 'Edit Task';
    $('#task-id').value = task.id;
    $('#task-name').value = task.name;
    $('#task-priority').value = task.priority;
    $('#task-cat').value = task.cat;
    $('#task-due').value = toLocalInputValue(task.due);
    $('#task-effort').value = task.effort;
  } else {
    $('#task-form-title').textContent = 'New Task';
    $('#task-id').value = '';
    const tomorrow = new Date(Date.now() + 86400000);
    $('#task-due').value = toLocalInputValue(tomorrow.toISOString());
  }

  panel.classList.remove('hidden');
  $('#task-name').focus();
}

function initTaskForm() {
  $('#add-task-btn').addEventListener('click', () => openTaskForm());
  $('#task-form-cancel').addEventListener('click', () => {
    $('#task-form-panel').classList.add('hidden');
  });

  $('#task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#task-id').value;
    const data = {
      name: $('#task-name').value.trim(),
      priority: $('#task-priority').value,
      cat: $('#task-cat').value,
      due: new Date($('#task-due').value).toISOString(),
      effort: parseInt($('#task-effort').value, 10) || 3,
    };

    if (id) {
      updateTask(id, data);
      showToast('Task updated', 'xp-positive');
    } else {
      createTask(data);
    }
    $('#task-form-panel').classList.add('hidden');
  });

  $$('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTasks();
    });
  });
}

// ─── Death Clock ───
function formatCountdown(ms) {
  if (ms <= 0) {
    const overdue = Math.abs(ms);
    const hrs = Math.floor(overdue / 3600000);
    const mins = Math.floor((overdue % 3600000) / 60000);
    const secs = Math.floor((overdue % 60000) / 1000);
    return `-${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getDeathClockClass(hrs) {
  if (hrs < 0) return 'overdue';
  if (hrs < 1) return 'red-fast';
  if (hrs < 4) return 'amber';
  return 'safe';
}

function renderDeathClocks() {
  const container = $('#death-clocks');
  const pending = state.tasks.filter((t) => !t.done);
  const top = getSortedTasks(pending).slice(0, 4);

  if (top.length === 0) {
    container.innerHTML = '<div class="death-clock-empty">No pending deadlines</div>';
    return;
  }

  container.innerHTML = top.map((task) => {
    const hrs = hoursUntil(task.due);
    const cls = getDeathClockClass(hrs);
    const ms = new Date(task.due) - Date.now();
    return `
      <div class="death-clock ${cls}" data-id="${task.id}">
        <div class="death-clock-name">${escapeHtml(task.name)}</div>
        <div class="death-clock-time" data-due="${task.due}">${formatCountdown(ms)}</div>
      </div>
    `;
  }).join('');
}

function startDeathClockInterval() {
  if (deathClockInterval) clearInterval(deathClockInterval);

  deathClockInterval = setInterval(() => {
    $$('.death-clock-time').forEach((el) => {
      const ms = new Date(el.dataset.due) - Date.now();
      el.textContent = formatCountdown(ms);
      const clock = el.closest('.death-clock');
      if (clock) {
        clock.className = `death-clock ${getDeathClockClass(ms / 3600000)}`;
      }
    });
    updateCrisisBanner();
  }, 1000);
}

// ─── Habit Tracker ───
function createHabit(name) {
  state.habits.push({
    id: uid(),
    name,
    streak: 0,
    history: [false, false, false, false, false, false, false],
    todayDone: false,
  });
  saveState();
  addXP(5, 'New habit added');
  renderHabits();
}

function toggleHabit(id) {
  const habit = state.habits.find((h) => h.id === id);
  if (!habit) return;

  habit.todayDone = !habit.todayDone;
  habit.history[6] = habit.todayDone;

  if (habit.todayDone) {
    habit.streak += 1;
    addXP(10, 'Habit completed!');
  } else {
    habit.streak = Math.max(0, habit.streak - 1);
    addXP(-5, 'Habit unchecked');
  }

  saveState();
  renderHabits();
  renderDashboardHabits();
}

function deleteHabit(id) {
  state.habits = state.habits.filter((h) => h.id !== id);
  saveState();
  renderHabits();
}

function renderHabitItem(habit, { compact = false } = {}) {
  const el = document.createElement('div');
  el.className = 'habit-item';
  el.innerHTML = `
    <button class="habit-check${habit.todayDone ? ' checked' : ''}" data-id="${habit.id}">
      ${habit.todayDone ? '✓' : ''}
    </button>
    <div class="habit-info">
      <div class="habit-name">${escapeHtml(habit.name)}</div>
      <div class="habit-streak">🔥 ${habit.streak} day streak</div>
    </div>
    ${compact ? '' : `
    <div class="habit-dots">
      ${habit.history.map((d) => `<span class="habit-dot${d ? ' done' : ''}"></span>`).join('')}
    </div>
    <button class="habit-delete" data-id="${habit.id}">🗑️</button>`}
  `;

  el.querySelector('.habit-check').addEventListener('click', () => toggleHabit(habit.id));
  if (!compact) {
    el.querySelector('.habit-delete').addEventListener('click', () => {
      if (confirm('Delete this habit?')) deleteHabit(habit.id);
    });
  }
  return el;
}

function renderHabits() {
  const list = $('#habits-list');
  list.innerHTML = '';
  if (state.habits.length === 0) {
    list.innerHTML = '<div class="empty-state">No habits yet. Start building good routines!</div>';
    return;
  }
  state.habits.forEach((h) => list.appendChild(renderHabitItem(h)));
}

function renderDashboardHabits() {
  const container = $('#dashboard-habits');
  container.innerHTML = '';
  if (state.habits.length === 0) {
    container.innerHTML = '<div class="empty-state">No habits tracked</div>';
    return;
  }
  state.habits.forEach((h) => container.appendChild(renderHabitItem(h, { compact: true })));
}

function initHabitForm() {
  $('#add-habit-btn').addEventListener('click', () => {
    $('#habit-form-panel').classList.remove('hidden');
    $('#habit-name').focus();
  });

  $('#habit-form-cancel').addEventListener('click', () => {
    $('#habit-form-panel').classList.add('hidden');
  });

  $('#habit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#habit-name').value.trim();
    if (name) createHabit(name);
    $('#habit-form-panel').classList.add('hidden');
    $('#habit-form').reset();
  });
}

// ─── Mood Check-in ───
function showMoodModal() {
  const lastMood = localStorage.getItem(MOOD_KEY);
  if (lastMood === todayKey()) return;
  $('#mood-modal').classList.remove('hidden');
}

function setMood(mood, energy) {
  state.mood = mood;
  state.energy = energy;
  localStorage.setItem(MOOD_KEY, todayKey());
  saveState();
  renderMood();
  $('#mood-modal').classList.add('hidden');

  if (energy <= 2) {
    showToast('Low energy mode: tasks sorted by effort', 'xp-positive');
  }
  renderTasks();
  renderDashboardTasks();
}

function renderMood() {
  if (state.mood) {
    $('#mood-emoji').textContent = MOOD_EMOJIS[state.mood];
    $('#mood-label').textContent = MOOD_LABELS[state.mood];
  } else {
    $('#mood-emoji').textContent = '😊';
    $('#mood-label').textContent = 'Not set';
  }
}

function initMoodModal() {
  $$('.mood-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      setMood(parseInt(btn.dataset.mood, 10), parseInt(btn.dataset.energy, 10));
    });
  });

  $('#mood-modal .modal-backdrop').addEventListener('click', () => {
    if (!state.mood) setMood(3, 3);
    else $('#mood-modal').classList.add('hidden');
  });
}

// ─── Commitment Contracts ───
function createContract(data) {
  state.contracts.push({
    id: uid(),
    task: data.task,
    consequence: data.consequence,
    deadline: data.deadline,
    signed: new Date().toISOString(),
  });
  saveState();
  addXP(10, 'Contract signed!');
  renderContracts();
  showToast('Contract signed! Stay accountable.', 'xp-positive');
}

function renderContracts() {
  const container = $('#dashboard-contracts');
  if (state.contracts.length === 0) {
    container.innerHTML = '<div class="contract-empty">No active contracts</div>';
    return;
  }

  container.innerHTML = state.contracts.map((c) => `
    <div class="contract-item">
      <div class="contract-task">📜 ${escapeHtml(c.task)}</div>
      <div class="contract-consequence">⚠️ ${escapeHtml(c.consequence)}</div>
      <div class="contract-deadline">Due: ${formatDateTime(c.deadline)}</div>
    </div>
  `).join('');
}

function initContractModal() {
  $('#contract-btn').addEventListener('click', () => {
    $('#contract-modal').classList.remove('hidden');
    const tomorrow = new Date(Date.now() + 86400000);
    $('#contract-deadline').value = toLocalInputValue(tomorrow.toISOString());
  });

  $('#contract-cancel').addEventListener('click', () => {
    $('#contract-modal').classList.add('hidden');
  });

  $('#contract-modal .modal-backdrop').addEventListener('click', () => {
    $('#contract-modal').classList.add('hidden');
  });

  $('#contract-form').addEventListener('submit', (e) => {
    e.preventDefault();
    createContract({
      task: $('#contract-task').value.trim(),
      consequence: $('#contract-consequence').value.trim(),
      deadline: new Date($('#contract-deadline').value).toISOString(),
    });
    $('#contract-modal').classList.add('hidden');
    $('#contract-form').reset();
  });
}

// ─── Analytics ───
function renderProcrastinationChart() {
  const container = $('#procrastination-chart');
  const categories = ['work', 'personal', 'health', 'learning', 'other'];
  const stats = {};

  categories.forEach((cat) => {
    const catTasks = state.tasks.filter((t) => t.cat === cat);
    if (catTasks.length === 0) {
      stats[cat] = 0;
      return;
    }
    const overdueCount = catTasks.filter((t) => isOverdue(t) || (t.done && new Date(t.due) < new Date(t.created))).length;
    stats[cat] = Math.round((overdueCount / catTasks.length) * 100);
  });

  const maxVal = Math.max(...Object.values(stats), 1);

  container.innerHTML = categories.map((cat) => {
    const val = stats[cat];
    const width = (val / maxVal) * 100;
    return `
      <div class="bar-row">
        <span class="bar-label">${cat}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${width}%">
            <span class="bar-value">${val}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderStressHeatmap() {
  const container = $('#stress-heatmap');
  const weeks = 8;
  const days = 7;
  let html = '';

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const stress = Math.floor(Math.random() * 5);
      const opacity = 0.15 + stress * 0.17;
      const hue = stress < 2 ? 142 : stress < 3 ? 45 : 0;
      html += `<div class="heatmap-cell" style="background: hsla(${hue}, 70%, 50%, ${opacity})" title="Mock stress level: ${stress}/4"></div>`;
    }
  }

  container.innerHTML = html;
}

function renderAnalytics() {
  renderProcrastinationChart();
  renderStressHeatmap();
}

// ─── Schedule ───
function renderSchedule() {
  const container = $('#schedule-blocks');
  const note = $('#schedule-note');

  if (state.schedule.length === 0) {
    container.innerHTML = '';
    note.classList.remove('hidden');
    return;
  }

  note.classList.add('hidden');
  container.innerHTML = state.schedule.map((block) => `
    <div class="schedule-block">
      <div class="schedule-time">${block.time}</div>
      <div>
        <div class="schedule-task-name">${escapeHtml(block.task)}</div>
        <div class="schedule-task-meta">${block.meta || ''}</div>
      </div>
    </div>
  `).join('');
}

function generateMockSchedule() {
  const pending = getSortedTasks(state.tasks.filter((t) => !t.done));
  const startHour = 9;
  state.schedule = pending.slice(0, 6).map((task, i) => {
    const hour = startHour + i;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour > 12 ? hour - 12 : hour;
    return {
      time: `${h12}:00 ${ampm}`,
      task: task.name,
      meta: `${task.priority} · ${task.cat} · effort ${task.effort}`,
    };
  });
  saveState();
  renderSchedule();
}

// ─── Gemini API ───
async function callGemini(prompt, systemContext = '') {
  if (GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    return mockGeminiResponse(prompt);
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: systemContext ? { parts: [{ text: systemContext }] } : undefined,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI.';
  } catch (err) {
    console.error('Gemini call failed:', err);
    return mockGeminiResponse(prompt);
  }
}

function mockGeminiResponse(prompt) {
  const lower = prompt.toLowerCase();
  const pending = state.tasks.filter((t) => !t.done);
  const top = getSortedTasks(pending).slice(0, 3);

  if (lower.includes('autopilot') || lower.includes('plan')) {
    const plan = top.map((t, i) => `${i + 1}. ${t.name} (${t.priority}, due ${formatDateTime(t.due)})`).join('\n');
    return `[Demo Mode — Add your Gemini API key for real AI]\n\nHere's your optimized day plan:\n\n${plan}\n\nFocus on "${top[0]?.name || 'your top task'}" first — it has the highest urgency score. Take a 5-min break between tasks. You've got this! 💪`;
  }

  if (lower.includes('overdue') || lower.includes('late')) {
    const overdue = pending.filter(isOverdue);
    if (overdue.length === 0) return 'Great news — no overdue tasks! Keep up the momentum.';
    return `You have ${overdue.length} overdue task(s). Tackle "${overdue[0].name}" immediately — it's costing you XP. Break it into 15-min chunks if it feels overwhelming.`;
  }

  if (lower.includes('habit')) {
    const undone = state.habits.filter((h) => !h.todayDone);
    if (undone.length === 0) return 'All habits done today! Amazing consistency. 🔥';
    return `You still have ${undone.length} habit(s) to check off: ${undone.map((h) => h.name).join(', ')}. Start with the easiest one to build momentum.`;
  }

  return `[Demo Mode — Add your Gemini API key for real AI]\n\nI'm LifeSaver, your productivity companion! You have ${pending.length} pending tasks and ${state.habits.filter((h) => !h.todayDone).length} habits remaining today. Your level: ${getLevel().name} (${state.xp} XP). Ask me to plan your day, prioritize tasks, or help with procrastination!`;
}

function buildAIContext() {
  const pending = state.tasks.filter((t) => !t.done);
  const overdue = pending.filter(isOverdue);
  return `You are LifeSaver, an AI productivity coach. Be concise, actionable, and motivating.
User stats: Level ${getLevel().name}, ${state.xp} XP, ${state.dayStreak}-day streak.
Mood/energy: ${state.mood ? MOOD_LABELS[state.mood] : 'unknown'} (${state.energy || '?'} /5).
Pending tasks (${pending.length}): ${pending.map((t) => `"${t.name}" [${t.priority}, due ${formatDateTime(t.due)}, effort ${t.effort}]`).join('; ')}.
Overdue: ${overdue.length}. Habits today: ${state.habits.filter((h) => h.todayDone).length}/${state.habits.length} done.`;
}

// ─── AI Chat ───
async function sendChat(message) {
  if (!message.trim()) return;

  state.chatHistory.push({ role: 'user', text: message });
  renderChat();
  saveState();

  $('#typing-indicator').classList.remove('hidden');
  const input = $('#chat-input');
  input.disabled = true;

  const context = buildAIContext();
  const reply = await callGemini(message, context);

  $('#typing-indicator').classList.add('hidden');
  input.disabled = false;

  state.chatHistory.push({ role: 'assistant', text: reply });
  saveState();
  renderChat();
  addXP(2, 'AI chat interaction');
}

function renderChat() {
  const container = $('#chat-messages');
  container.innerHTML = state.chatHistory.map((msg) => {
    const cls = msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'assistant';
    return `<div class="chat-msg ${cls}">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function initChat() {
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const msg = input.value.trim();
    if (msg) {
      sendChat(msg);
      input.value = '';
    }
  });
}

// ─── AI Autopilot ───
async function runAutopilot() {
  showToast('🚀 Running Autopilot...', 'xp-positive');
  switchView('schedule');

  const pending = state.tasks.filter((t) => !t.done);
  const taskSummary = pending.map((t) =>
    `- ${t.name} (priority: ${t.priority}, due: ${formatDateTime(t.due)}, effort: ${t.effort}, score: ${computeScore(t)})`
  ).join('\n');

  const prompt = `Create an optimized daily schedule for these tasks:\n${taskSummary}\n\nUser energy level: ${state.energy || 3}/5. Format as numbered time blocks.`;
  const context = buildAIContext();

  $('#typing-indicator').classList.remove('hidden');
  const reply = await callGemini(prompt, context);
  $('#typing-indicator').classList.add('hidden');

  state.chatHistory.push({ role: 'system', text: '🚀 Autopilot activated' });
  state.chatHistory.push({ role: 'assistant', text: reply });
  saveState();

  generateMockSchedule();
  addXP(15, 'Autopilot day plan');
  showToast('Day plan ready!', 'xp-positive');

  renderChat();
}

// ─── Voice Input ───
function initVoiceInput() {
  const btn = $('#voice-btn');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    btn.title = 'Voice not supported in this browser';
    btn.addEventListener('click', () => {
      showToast('Voice input not supported — try Chrome', 'xp-negative');
      switchView('chat');
    });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => btn.classList.add('listening');
  recognition.onend = () => btn.classList.remove('listening');

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.toLowerCase().trim();
    handleVoiceCommand(transcript);
  };

  recognition.onerror = () => {
    btn.classList.remove('listening');
    showToast('Voice recognition failed', 'xp-negative');
  };

  btn.addEventListener('click', () => {
    try {
      recognition.start();
      showToast('🎤 Listening...', 'xp-positive');
    } catch {
      showToast('Microphone busy — try again', 'xp-negative');
    }
  });
}

function handleVoiceCommand(transcript) {
  showToast(`Heard: "${transcript}"`, 'xp-positive');

  if (transcript.includes('add task') || transcript.includes('new task') || transcript.includes('create task')) {
    const name = transcript.replace(/(add|new|create)\s*task\s*/i, '').trim();
    if (name) {
      createTask({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        priority: 'medium',
        due: new Date(Date.now() + 86400000).toISOString(),
        cat: 'personal',
        effort: 3,
      });
      showToast(`Task created: ${name}`, 'xp-positive');
    } else {
      switchView('tasks');
      openTaskForm();
    }
    return;
  }

  if (transcript.includes('autopilot') || transcript.includes('plan my day')) {
    runAutopilot();
    return;
  }

  if (transcript.includes('check habit') || transcript.includes('complete habit')) {
    const undone = state.habits.find((h) => !h.todayDone);
    if (undone) {
      toggleHabit(undone.id);
      showToast(`Habit checked: ${undone.name}`, 'xp-positive');
    } else {
      showToast('All habits already done!', 'xp-positive');
    }
    return;
  }

  if (transcript.includes('show tasks') || transcript.includes('my tasks')) {
    switchView('tasks');
    return;
  }

  if (transcript.includes('dashboard') || transcript.includes('home')) {
    switchView('dashboard');
    return;
  }

  switchView('chat');
  sendChat(transcript);
}

// ─── Day Streak Tracking ───
function updateDayStreak() {
  const today = todayKey();
  if (state.lastActiveDate === today) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toDateString();

  if (state.lastActiveDate === yesterdayKey) {
    state.dayStreak += 1;
    addXP(5, 'Daily login streak');
  } else if (state.lastActiveDate !== today) {
    state.dayStreak = 1;
  }

  state.lastActiveDate = today;

  state.habits.forEach((h) => {
    h.history.shift();
    h.history.push(h.todayDone);
    h.todayDone = false;
  });

  saveState();
}

// ─── Master Render ───
function renderAll() {
  renderXP();
  renderDashboardTasks();
  renderDeathClocks();
  renderDashboardHabits();
  renderMood();
  renderContracts();
  renderTasks();
  updateCrisisBanner();
}

// ─── Schedule Button ───
function initSchedule() {
  $('#generate-schedule-btn').addEventListener('click', async () => {
    showToast('Generating schedule...', 'xp-positive');
    await runAutopilot();
  });

  $('#autopilot-btn').addEventListener('click', runAutopilot);
}

// ─── Initialization ───
function init() {
  loadState();
  updateDayStreak();

  initNavigation();
  initTaskForm();
  initHabitForm();
  initMoodModal();
  initContractModal();
  initChat();
  initVoiceInput();
  initSchedule();

  renderAll();
  renderChat();
  startDeathClockInterval();
  showMoodModal();

  console.log('⚡ LifeSaver AI initialized');
}

document.addEventListener('DOMContentLoaded', init);
