// Niji dashboard — one page, role-aware views (hash routing). Data comes from store.js.
function updateDashboardClock() {
  const clock = document.getElementById('dashboard-clock');
  const clockDate = document.getElementById('dashboard-date');
  const clockTime = document.getElementById('dashboard-time');
  if (!clock || !clockDate || !clockTime) return;

  const now = new Date();
  const date = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  clock.dateTime = now.toISOString();
  clockDate.textContent = date;
  clockTime.textContent = time;
  clock.setAttribute('aria-label', `Current local date and time: ${date} ${time}`);
}

updateDashboardClock();
if (!window.clockInterval) window.clockInterval = window.setInterval(updateDashboardClock, 1000);

(async function () {
  let currentUserCheck;
  let redirecting = false;
  const redirectTo = (path) => {
    if (redirecting) return;
    redirecting = true;
    window.location.replace(path);
  };
  const verifyCurrentUser = () => {
    if (!currentUserCheck) {
      currentUserCheck = currentUser().finally(() => { currentUserCheck = null; });
    }
    return currentUserCheck;
  };

  function showVerificationError(message) {
    clearIdentityCache();
    document.getElementById('view').textContent = message;
    document.getElementById('sidenav')?.replaceChildren();
    document.getElementById('tabbar')?.replaceChildren();
    document.getElementById('hdr-avatar')?.replaceChildren();
    document.getElementById('hdr-name').textContent = '';
    document.getElementById('hdr-role').textContent = '';
    document.querySelectorAll('[data-modal]').forEach((modal) => modal.remove());
    document.documentElement.style.visibility = 'visible';
  }

  window.addEventListener('pagehide', () => {
    document.documentElement.style.visibility = 'hidden';
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    document.documentElement.style.visibility = 'hidden';
    void verifyCurrentUser()
      .then((user) => {
        if (!user) redirectTo('index.html');
        else if (!user.profileComplete) {
          redirectTo(user.role === 'professor' ? 'professor-onboarding.html' : 'onboarding.html');
        }
        else document.documentElement.style.visibility = 'visible';
      })
      .catch((error) => {
        console.error('Could not verify the dashboard session:', error);
        showVerificationError('Could not verify your sign-in. Reload the page and try again.');
      });
  });

  let first;
  try {
    first = await verifyCurrentUser();
  } catch (error) {
    console.error('Could not load the Appwrite profile:', error);
    showVerificationError(`Could not load your profile: ${error.message || error}`);
    return;
  }
  if (!first) return redirectTo('index.html');
  if (!first.profileComplete) {
    return redirectTo(first.role === 'professor' ? 'professor-onboarding.html' : 'onboarding.html');
  }
  let me = first;
  try {
    await refreshDirectory();
  } catch (error) {
    console.error('Could not load the faculty directory:', error);
    if (error?.code === 401) return redirectTo('index.html');
    window.nijiDirectoryError = error.message || String(error);
  }

  const $ = (s) => document.querySelector(s);
  const state = { query: '', filter: 'all', college: '', sort: 'asc', showArchived: false };
  $('#sidebar-toggle').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    const nextExpanded = !expanded;
    button.setAttribute('aria-expanded', String(nextExpanded));
    button.setAttribute('aria-label', nextExpanded ? 'Hide sidebar' : 'Show sidebar');
    $('#dashboard-layout').classList.toggle('sidebar-collapsed', !nextExpanded);
  });
  const update = async (fn) => {
    const updated = await updateCurrentUser(fn);
    if (updated) me = updated;
    return updated;
  };
  const updateLocal = (fn) => {
    const updated = updateLocalUserData(fn);
    if (updated) me = updated;
    return updated;
  };
  const fd = (f) => Object.fromEntries(new FormData(f));
  const stOf = (k) => STATUSES[k] || STATUSES.away;
  const statusUpdatedLabel = (value) => {
    if (!value) return 'Not updated yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not updated yet';
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `at ${weekday}. ${date.toLocaleString('en-US')}`;
  };

  // ---------- small render helpers ----------
  const ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c1-3.2 3.5-5 6.5-5s5.5 1.8 6.5 5"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15 14.3c2.2.4 4 1.9 4.7 4.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/>',
  };
  const svg = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const displayName = (user) => {
    const firstName = String(user?.firstName || '').trim();
    const middleName = String(user?.middleName || '').trim();
    const lastName = String(user?.lastName || '').trim();
    if (!firstName && !lastName) return user?.name || '';
    return [firstName, middleName, lastName].filter(Boolean).join(' ');
  };
  const directoryName = (user) => {
    const firstName = String(user?.firstName || '').trim();
    const middleName = String(user?.middleName || '').trim();
    const lastName = String(user?.lastName || '').trim();
    if (!firstName && !middleName && !lastName) {
      const nameParts = String(user?.name || '').trim().split(/\s+/).filter(Boolean);
      if (nameParts.length < 3) return user?.name || '';
      const middlePart = nameParts[nameParts.length - 2];
      const middleInitial = middlePart.endsWith('.')
        ? middlePart
        : `${Array.from(middlePart)[0].toUpperCase()}.`;
      return [...nameParts.slice(0, -2), middleInitial, nameParts[nameParts.length - 1]].join(' ');
    }
    const middleInitial = middleName ? `${Array.from(middleName)[0].toUpperCase()}.` : '';
    return [firstName, middleInitial, lastName].filter(Boolean).join(' ');
  };
  const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const avatar = (n, s = 40) => `<div class="shrink-0 rounded-full bg-[#004687] text-[#f8f4e8] grid place-items-center text-[12px] font-bold" style="width:${s}px;height:${s}px">${esc(initials(n))}</div>`;
  const tag = (text, color, dot = true) => `<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap" style="background:${color}22;color:${color}">${dot ? `<span class="size-1.5 rounded-full" style="background:${color}"></span>` : ''}${text}</span>`;
  const pill = (k) => tag(stOf(k).label, stOf(k).color);
  const classTag = (c) => { const n = nowHM(); return n < c.start ? tag('Upcoming', '#6b7280', false) : n <= c.end ? tag('On Class', '#2563eb') : tag('Done', '#6b7280', false); };
  const scheduleDay = (day) => ['Daily', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day] || 'Daily';
  const field = (label, input, extra = '') => `<label class="block ${extra}"><span class="${UI.label}">${label}</span>${input}</label>`;
  const professors = () => loadDb().users.filter((u) => u.role === 'professor');
  const professorSearch = (professorId = '') => {
    const professor = professors().find((p) => p.appwriteUserId === professorId);
    const name = professor ? displayName(professor) : '';
    return `<div data-professor-search class="relative">
      <input type="search" data-professor-query value="${esc(name)}" autocomplete="off" aria-label="Search professor by name" aria-autocomplete="list" aria-expanded="false" placeholder="Search by professor name" class="${UI.input}">
      <input type="hidden" name="prof" data-professor-id value="${esc(professorId)}">
      <div data-professor-results role="listbox" class="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[7px] border border-[#475569]/30 dark:border-[#9ca3af]/30 bg-[#f9f6ee] dark:bg-[#2f2f2f] shadow-lg" aria-live="polite" hidden>
        <p class="px-3 py-2 text-[12px] ${UI.muted}">Type a professor's name to search.</p>
      </div>
    </div>`;
  };
  const normalizeFacultyName = (value) => String(value || '').toLowerCase().replace(/^department of\s+|^dept\.?\s+of\s+/, '').replace(/^(bachelor of science in|bachelor of arts in|bachelor in|associate in|diploma in)\s+/, '').replace(/[^a-z0-9]/g, '');
  const collegeForFaculty = (department) => {
    if (ICCT_COLLEGES.includes(department)) return department;
    const normalized = normalizeFacultyName(department);
    return ICCT_COLLEGES.find((college) => ICCT_PROGRAMS[college].some((program) => normalizeFacultyName(program) === normalized)) || '';
  };
  const googleEmail = (me) => me.provider === 'google' ? me.email : (me.linkedGoogleEmail || '');
  const byStart = (a) => [...(a || [])].sort((x, y) => x.start.localeCompare(y.start));
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const title = (t, sub) => `<div><h1 class="text-[22px] font-bold ${UI.strong}">${t}</h1><p class="text-[13px] font-light ${UI.muted}">${sub}</p></div>`;
  const approvalNotice = (me) => me.role === 'professor' && !me.facultyApproved
    ? `<div role="status" class="${UI.card} border-amber-500 text-[13px] text-amber-800 dark:text-amber-200"><p class="font-semibold">Your professor account is pending for approval.</p>
    <p class="mt-1">Please contact the system administrator via black.mist.bautista@gmail.com to get your account approved.</p></div>`
    : '';

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.className = 'fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[#0c1622] text-[#f8f4e8] text-[13px] px-4 py-2 shadow-lg';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  const classRow = (c, del) => `<li class="flex items-center justify-between gap-3 text-[13px]">
    <div class="min-w-0"><span class="font-semibold ${UI.strong}">${fmt12(c.start)} – ${fmt12(c.end)}</span>
    <span class="block font-light ${UI.muted} truncate">${scheduleDay(c.dayOfWeek)} · ${esc(c.subject)}${c.room ? ' · Room ' + esc(c.room) : ''}</span></div>
    <div class="flex items-center gap-3">${classTag(c)}${del ? `<button data-action="del-class" data-id="${c.id}" class="text-[12px] font-medium text-[#dc2626]">Delete</button>` : ''}</div></li>`;

  const hero = (me, sub) => `
    <div class="lg:hidden flex items-center gap-3">${avatar(displayName(me), 48)}<div><p class="text-[12px] font-light ${UI.muted}">${greeting()},</p><p class="text-[16px] font-bold ${UI.strong}">${esc(displayName(me))}</p></div></div>
    <div class="hidden lg:block relative overflow-hidden rounded-[14px] h-[140px] bg-[url('assets/day.jpg')] dark:bg-[url('assets/night.jpg')] bg-cover bg-center">
      <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10"></div>
      <div class="relative z-10 h-full flex flex-col justify-center px-8"><p class="text-[14px] font-light text-[#e5e7eb]">${greeting()},</p><p class="text-[24px] font-bold text-[#f8f4e8]">${esc(displayName(me))}</p><p class="text-[13px] font-light text-[#e5e7eb]">${sub}</p></div>
    </div>`;

  // ---------- views ----------
  const V = {};

  function profHome(me) {
    const st = stOf(me.status.state);
    const sched = byStart(me.schedule);
    return hero(me, esc(me.department)) + `
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="${UI.card}">
        <p class="text-[13px] font-semibold ${UI.strong}">Your Current Status</p>
        <p class="mt-2 flex items-center gap-2 text-[20px] font-bold" style="color:${st.color}"><span class="size-2.5 rounded-full" style="background:${st.color}"></span>${st.label}</p>
        <p class="mt-1 text-[13px] font-light ${UI.muted}"><span class="font-semibold">Availability description:</span> ${st.desc}</p>
        ${me.statusMessage ? `<p class="mt-2 text-[13px] ${UI.strong}"><span class="font-semibold">Message to students:</span> ${esc(me.statusMessage)}</p>` : ''}
        <p class="mt-1 text-[11px] ${UI.muted}">Updated ${esc(statusUpdatedLabel(me.status.updatedAt))}</p>
        ${me.facultyApproved
          ? `<button data-action="open-status" class="mt-4 ${UI.btn}">Change Status</button>`
          : `<p class="mt-4 text-[13px] font-semibold text-amber-700 dark:text-amber-300">Status changes are locked until approval.</p>`}
      </div>
      <div class="${UI.card}">
        <p class="text-[13px] font-semibold ${UI.strong} mb-3">Quick Overview</p>
        <div class="grid grid-cols-2 gap-4 text-[13px]">
          <div><p class="font-light ${UI.muted}">Classes today</p><p class="text-[20px] font-bold ${UI.strong}">${sched.length}</p></div>
          <div><p class="font-light ${UI.muted}">Directory status</p><p class="text-[20px] font-bold ${UI.strong}">${!me.facultyApproved ? 'Pending approval' : me.profileComplete ? 'Published' : 'Draft'}</p></div>
        </div>
      </div>
    </div>
    <div class="${UI.card}">
      <div class="flex items-center justify-between"><p class="text-[14px] font-bold ${UI.strong}">Today's Schedule</p><a href="#schedule" class="text-[12px] font-medium text-[#005a9c]">Manage schedule →</a></div>
      <p class="mt-1 text-[11px] ${UI.muted}">Saved in this browser only; not shared to the directory.</p>
      ${sched.length ? `<ul class="mt-3 space-y-3">${sched.map((c) => classRow(c, false)).join('')}</ul>` : `<p class="mt-3 text-[13px] ${UI.muted}">No classes yet. <a href="#schedule" class="font-medium text-[#005a9c]">Set up your daily schedule</a> so students know when to find you.</p>`}
    </div>`;
  }

  function studentHome(me) {
    const profs = professors();
    const rows = (me.subjects || []).filter((s) => !s.archived).map((s) => {
      const p = profs.find((x) => x.appwriteUserId === s.facultyId || x.email === s.professorEmail);
      return `<li class="flex items-center justify-between gap-3 text-[13px]"><div class="min-w-0"><span class="font-semibold ${UI.strong}">${esc(s.name)}</span>
        <span class="block font-light ${UI.muted} truncate">${p ? esc(displayName(p)) : 'No professor assigned'}</span>${p ? `<span class="block font-light ${UI.muted} line-clamp-2"><span class="font-semibold">Availability description:</span> ${esc(stOf(p.status.state).desc)}</span>${p.statusMessage ? `<span class="block mt-1 ${UI.strong}"><span class="font-semibold">Message to students:</span> ${esc(p.statusMessage)}</span>` : ''}` : ''}</div>${p ? pill(p.status.state) : ''}</li>`;
    }).join('');
    return hero(me, 'Find and connect with your faculty members.') + `
    <div class="${UI.card}">
      <p class="text-[16px] font-bold ${UI.strong}">Find a Faculty Member</p>
      <p class="mt-1 text-[13px] font-light ${UI.muted}">Search by name, subject, or department.</p>
      <form data-form="search" class="mt-3 flex gap-2"><input name="q" placeholder="e.g. Santos, Computer Science" class="${UI.input} flex-1" /><button class="${UI.btn}">Search</button></form>
    </div>
    <div class="${UI.card}">
      <div class="flex items-center justify-between"><p class="text-[14px] font-bold ${UI.strong}">My Professors</p><a href="#subjects" class="text-[12px] font-medium text-[#005a9c]">Manage subjects →</a></div>
      ${rows ? `<ul class="mt-3 space-y-3">${rows}</ul>` : `<p class="mt-3 text-[13px] ${UI.muted}">No subjects yet. <a href="#subjects" class="font-medium text-[#005a9c]">Add a subject</a> and its professor to see their availability here.</p>`}
    </div>`;
  }
  V.home = (me) => (me.role === 'professor' ? profHome(me) : studentHome(me));
  V.schedule = (me) => title('My Schedule', 'Manage your schedule in this browser. Schedule entries are not stored in Appwrite or shared to the directory.') + `
    <form data-form="add-class" class="${UI.card} grid sm:grid-cols-2 gap-3">
      ${field('Subject / class', `<input name="subject" required maxlength="60" placeholder="e.g. Web Development" class="${UI.input}">`, 'sm:col-span-2')}
      ${field('Room', `<input name="room" maxlength="20" placeholder="e.g. B1.28" class="${UI.input}">`)}
      ${field('Day', `<select name="dayOfWeek" class="${UI.input}"><option value="0">Every day</option>${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => `<option value="${index + 1}">${day}</option>`).join('')}</select>`)}
      <div class="grid grid-cols-2 gap-3">${field('Start', `<input type="time" name="start" required class="${UI.input}">`)}${field('End', `<input type="time" name="end" required class="${UI.input}">`)}</div>
      <div class="sm:col-span-2"><button class="${UI.btn}">Add class</button></div>
    </form>
    <div class="${UI.card}">${(me.schedule || []).length ? `<ul class="space-y-4">${byStart(me.schedule).map((c) => classRow(c, true)).join('')}</ul>` : `<p class="text-[13px] ${UI.muted}">No classes yet. Add your first one above.</p>`}</div>`;

  V.subjects = (me) => {
    const profs = professors();
    const link = 'text-[12px] font-medium whitespace-nowrap';
    const activeCard = (s) => {
      const p = profs.find((x) => x.appwriteUserId === s.facultyId || x.email === s.professorEmail);
      return `<div class="${UI.card}">
        <div class="flex items-start justify-between gap-3"><p class="text-[15px] font-bold ${UI.strong}">${esc(s.name)}</p>
          <div class="flex items-center gap-3"><button data-action="archive-subject" data-id="${s.id}" class="${link} text-[#005a9c]">Archive</button><button data-action="del-subject" data-id="${s.id}" class="${link} text-[#dc2626]">Delete</button></div></div>
        ${p ? `<div class="mt-3 flex items-start gap-3">${avatar(displayName(p), 36)}<div class="min-w-0 flex-1"><p class="text-[13px] font-semibold ${UI.strong} truncate">${esc(displayName(p))}</p><p class="text-[11px] font-light ${UI.muted} truncate">${esc(p.department || 'College/faculty not provided')}</p></div>${pill(p.status.state)}</div>
          <div class="mt-3 pt-3 border-t border-[#475569]/20 dark:border-[#9ca3af]/20">
            <p class="text-[13px] ${UI.strong} mb-2"><span class="font-semibold">Availability description:</span> ${esc(stOf(p.status.state).desc)}</p>
            ${p.statusMessage ? `<p class="text-[13px] ${UI.strong} mb-2"><span class="font-semibold">Message to students:</span> ${esc(p.statusMessage)}</p>` : ''}
            <p class="text-[11px] ${UI.muted}">Status updated ${esc(statusUpdatedLabel(p.status.updatedAt))}</p>
          </div>
          <button data-action="remove-prof" data-id="${s.id}" class="mt-3 text-[12px] font-medium text-[#005a9c]">Professor replaced? Remove professor</button>`
        : `<div class="mt-3 flex items-start gap-2"><div class="min-w-0 flex-1">${professorSearch()}</div><button data-action="assign" data-id="${s.id}" class="${UI.btn}">Assign</button></div>`}
      </div>`;
    };
    const archivedRow = (s) => {
      const p = profs.find((x) => x.appwriteUserId === s.facultyId || x.email === s.professorEmail);
      return `<li class="flex items-center justify-between gap-3 text-[13px]"><div class="min-w-0"><span class="font-semibold ${UI.strong}">${esc(s.name)}</span>
        <span class="block font-light ${UI.muted} truncate">${p ? esc(displayName(p)) : 'No professor assigned'}</span>${p ? `<span class="block text-[11px] font-light ${UI.muted} truncate">${esc(p.department || 'College/faculty not provided')}</span>` : ''}</div>
        <div class="flex items-center gap-3"><button data-action="restore-subject" data-id="${s.id}" class="${link} text-[#005a9c]">Restore</button><button data-action="del-subject" data-id="${s.id}" class="${link} text-[#dc2626]">Delete</button></div></li>`;
    };
    const all = me.subjects || [];
    const active = all.filter((s) => !s.archived);
    const archived = all.filter((s) => s.archived);
    return title('My Subjects', 'Add each subject with its professor to track their availability. This list is saved in this browser only. Archive a subject to tuck it away (you can restore it later), or delete it for good.') + `
    <form data-form="add-subject" class="${UI.card} grid sm:grid-cols-2 gap-3">
      ${field('Subject', `<input name="name" required maxlength="60" placeholder="e.g. Data Structures" class="${UI.input}">`)}
      <div class="block"><span class="${UI.label}">Professor (optional)</span>${professorSearch()}</div>
      <div class="sm:col-span-2"><button class="${UI.btn}">Add subject</button></div>
    </form>
    ${active.map(activeCard).join('') || `<p class="text-[13px] ${UI.muted}">${archived.length ? 'No active subjects.' : 'No subjects yet.'}</p>`}
    ${archived.length ? `<details class="${UI.card} !py-4"${state.showArchived ? ' open' : ''} data-archived-details>
      <summary class="cursor-pointer list-none text-[14px] font-bold ${UI.strong}">Archived subjects (${archived.length})</summary>
      <ul class="mt-4 space-y-4">${archived.map(archivedRow).join('')}</ul></details>` : ''}`;
  };

  V.directory = () => `<div class="flex items-start justify-between gap-3">${title('Faculty Directory', 'Live availability of approved professor accounts. Status updates are timestamped; schedules are not published to the directory.')}<button data-action="refresh-directory" class="${UI.btnGhost} shrink-0">Refresh</button></div>
    ${window.nijiDirectoryOutdated ? `<p class="${UI.card} text-[13px] text-amber-700 dark:text-amber-300">The deployed Appwrite Function is outdated and may expose unapproved or deleted professor accounts. Deploy the latest <code>files/appwrite-functions/data-api</code> source (or its <code>data-api.tar.gz</code> archive) to enforce approval before directory visibility.</p>` : ''}
    ${window.nijiDirectoryOutdated || window.nijiStatusMessagesEnabled ? '' : `<p class="${UI.card} text-[13px] text-amber-700 dark:text-amber-300">Student-facing messages are not enabled by the live Appwrite Function yet. Deploy the latest data-api.tar.gz, then re-save the message from the professor account.</p>`}
    <div class="${UI.card} space-y-3">
      <input id="dir-q" value="${esc(state.query)}" placeholder="Search by name, faculty, or college" class="${UI.input}">
      <div class="grid sm:grid-cols-2 gap-3">
        ${field('Faculty / college', `<select id="dir-college" aria-label="Filter faculty by college" class="${UI.input}"><option value="">All colleges</option>${ICCT_COLLEGES.map((college) => `<option value="${esc(college)}"${state.college === college ? ' selected' : ''}>${esc(college)}</option>`).join('')}</select>`)}
        ${field('Sort by name', `<select id="dir-sort" aria-label="Sort faculty alphabetically" class="${UI.input}"><option value="asc"${state.sort === 'asc' ? ' selected' : ''}>Alphabetical: A to Z</option><option value="desc"${state.sort === 'desc' ? ' selected' : ''}>Alphabetical: Z to A</option></select>`)}
      </div>
      <div class="flex flex-wrap gap-2">${['all', ...Object.keys(STATUSES)].map((k) => `<button data-action="chip" data-value="${k}" class="h-8 px-3 rounded-full text-[12px] font-semibold ${state.filter === k ? 'bg-[#004687] text-[#f8f4e8]' : 'border border-[#475569] dark:border-[#9ca3af] ' + UI.strong}">${k === 'all' ? 'All' : STATUSES[k].label}</button>`).join('')}</div>
    </div>
    <div id="dir-list" class="space-y-3"></div>`;

  function fillDir() {
    if (window.nijiDirectoryError) {
      $('#dir-list').innerHTML = `<p class="${UI.card} text-[13px] text-[#dc2626]">The faculty directory could not be loaded: ${esc(window.nijiDirectoryError)}</p>`;
      return;
    }
    const q = state.query.trim().toLowerCase();
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    const list = professors().filter((p) => (state.filter === 'all' || p.status.state === state.filter)
      && (!state.college || collegeForFaculty(p.department) === state.college)
      && (!q || [p.name, p.department, p.institution, ...(p.schedule || []).map((c) => c.subject)].join(' ').toLowerCase().includes(q)));
    list.sort((a, b) => collator.compare(directoryName(a), directoryName(b)) * (state.sort === 'desc' ? -1 : 1));
    const allProfessors = professors();
    const emptyMessage = !allProfessors.length
      ? (window.nijiDirectoryOutdated
        ? 'No approved professor profiles were returned. The deployed Appwrite Function may be outdated; deploy the latest data-api Function to enforce approval and exclude deleted accounts.'
        : 'No approved professor profiles are currently available.')
      : 'No professors match the current search and filters.';
    $('#dir-list').innerHTML = list.length ? list.map((p) => `
      <details class="${UI.card} !py-4">
        <summary class="flex items-center gap-3 cursor-pointer list-none">${avatar(directoryName(p))}
          <div class="min-w-0 flex-1"><p class="text-[14px] font-semibold ${UI.strong} truncate">${esc(directoryName(p))}</p><p class="text-[12px] font-light ${UI.muted} truncate">${esc(p.department)} · ${esc(p.institution)}</p></div>${pill(p.status.state)}</summary>
        <div class="mt-3 pt-3 border-t border-[#475569]/20 dark:border-[#9ca3af]/20">
          <p class="text-[13px] ${UI.strong} mb-2"><span class="font-semibold">Availability description:</span> ${esc(stOf(p.status.state).desc)}</p>
          ${p.statusMessage ? `<p class="text-[13px] ${UI.strong} mb-2"><span class="font-semibold">Message to students:</span> ${esc(p.statusMessage)}</p>` : ''}
          <p class="text-[11px] ${UI.muted}">Status updated ${esc(statusUpdatedLabel(p.status.updatedAt))}</p>
        </div>
      </details>`).join('') : `<p class="${UI.card} text-[13px] ${UI.muted}">${esc(emptyMessage)}</p>`;
  }

  V.profile = (me) => title('Profile', 'Your account details.') + `
    <form data-form="profile" class="${UI.card} space-y-3">
      <div class="flex items-center gap-3">${avatar(displayName(me), 48)}<div class="min-w-0"><p class="text-[15px] font-bold ${UI.strong}">${esc(displayName(me))}</p>
        <p class="text-[12px] ${UI.muted} truncate">${me.role === 'professor' ? 'Professor' : 'Student'} · ${esc(me.email)} · ${me.provider === 'google' ? 'Google sign-in' : 'Email & password'}</p></div></div>
      ${field('Last name', `<input name="lastName" autocomplete="family-name" required maxlength="80" value="${esc(me.lastName)}" class="${UI.input}">`)}
      ${field('First name', `<input name="firstName" autocomplete="given-name" required maxlength="80" value="${esc(me.firstName)}" class="${UI.input}">`)}
      ${field('Middle name', `<input name="middleName" autocomplete="additional-name" maxlength="80" value="${esc(me.middleName)}" class="${UI.input}">`)}
      ${field('College', `<input name="institution" required maxlength="100" value="${esc(me.institution)}" class="${UI.input}">`)}
      ${me.role === 'professor' ? field('Faculty', `<select name="department" required class="${UI.input}">${!collegeForFaculty(me.department) ? `<option value="${esc(me.department)}" selected>${esc(me.department)}</option>` : ''}${ICCT_COLLEGES.map((college) => `<option value="${esc(college)}"${collegeForFaculty(me.department) === college ? ' selected' : ''}>${esc(college)}</option>`).join('')}</select>`) : ''}
      <button class="${UI.btn}">Save changes</button>
    </form>
    <div class="${UI.card}">
      <p class="text-[14px] font-bold ${UI.strong}">Google account</p>
      <p class="mt-1 text-[12px] ${UI.muted}">${googleEmail(me) ? `Connected as ${esc(googleEmail(me))}.` : 'Link a Google account so you can use it to sign in.'} Google sign-in is handled by Appwrite.</p>
      ${me.provider === 'google'
        ? ''
        : googleEmail(me)
          ? '<button data-action="unlink-google" class="mt-3 text-[13px] font-semibold text-[#dc2626]">Unlink Google account</button>'
          : `<button data-action="link-google" class="mt-3 ${UI.btn}">Link account with Google</button>`}
    </div>
    <button data-action="logout" class="${UI.btnGhost}">Log out</button>
    <div class="${UI.card} !border-[#dc2626]/40">
      <p class="text-[14px] font-bold text-[#dc2626]">Delete account</p>
      <p class="mt-1 text-[12px] font-light ${UI.muted}">Permanently remove your ${me.role === 'professor' ? 'faculty' : 'student'} account and its data.</p>
      <button data-action="open-delete-account" class="mt-3 h-10 px-5 rounded-[9px] border border-[#dc2626] text-[14px] font-semibold text-[#dc2626]">Delete my account</button>
    </div>`;

  function statusModal(me) {
    openModal(`<form data-form="status" class="space-y-3">
      <p class="text-[16px] font-bold">Set your status and message</p>
      <p class="text-[12px] font-light ${UI.muted}">Students see your status and optional message on your directory card and linked subject list.</p>
      ${Object.entries(STATUSES).map(([k, s]) => `<label class="flex items-start gap-3 rounded-[10px] border border-[#475569]/40 dark:border-[#9ca3af]/40 p-3 cursor-pointer">
        <input type="radio" name="state" value="${k}" ${me.status.state === k ? 'checked' : ''} class="mt-1">
        <span><span class="block text-[14px] font-semibold" style="color:${s.color}">${s.label}</span><span class="block text-[12px] font-light ${UI.muted}">${s.desc}</span></span></label>`).join('')}
      ${field('Message for students (optional)', `<textarea name="statusMessage" maxlength="240" rows="3" placeholder="Add a short note students will see..." class="${UI.input} resize-y">${esc(me.statusMessage || '')}</textarea>`)}
      <div class="flex justify-end gap-2"><button type="button" data-close class="${UI.btnGhost}">Cancel</button><button class="${UI.btn}">Save</button></div>
    </form>`);
  }

  function deleteAccountModal(me) {
    const consequence = me.role === 'professor'
      ? 'Your profile, status, and browser-local schedule will be removed. Students tracking you will keep their subjects, but the professor slot will be cleared.'
      : 'Your profile, browser-local subjects, and archived subjects will be removed.';
    openModal(`<form data-form="delete-account" class="space-y-3">
      <p class="text-[16px] font-bold text-[#dc2626]">Delete your account?</p>
      <p class="text-[12px] font-light ${UI.muted}">${consequence} This can’t be undone.</p>
      ${field('Enter your account email to confirm', `<input name="confirmEmail" type="email" required autocomplete="email" placeholder="${esc(me.email)}" class="${UI.input}">`)}
      <p data-err class="hidden text-[12px] font-medium text-[#dc2626]"></p>
      <div class="flex justify-end gap-2"><button type="button" data-close class="${UI.btnGhost}">Cancel</button><button class="h-10 px-5 rounded-[9px] bg-[#dc2626] text-white text-[14px] font-semibold">Delete account</button></div>
    </form>`);
  }

  function logoutModal() {
    openModal(`<div class="space-y-4">
      <p class="text-[16px] font-bold">Are you sure you want to log-out?</p>
      <div class="flex justify-end gap-2"><button type="button" data-close class="${UI.btnGhost}">Cancel</button><button type="button" data-action="confirm-logout" class="${UI.btn}">Log out</button></div>
    </div>`);
  }

  // ---------- actions & forms ----------
  const A = {
    logout: logoutModal,
    'confirm-logout': (b) => { b.closest('[data-modal]').close(); return logout(); },
    'open-status': () => {
      if (!me.facultyApproved) return toast('Status changes are locked until your account is approved.');
      statusModal(me);
    },
    'open-delete-account': () => deleteAccountModal(me),
    'link-google': async () => {
      window.startGoogleOAuth('link-google');
    },
    'unlink-google': () => {
      const result = unlinkGoogleAccount();
      if (result.error) return toast(result.error);
      toast('Google account unlinked');
      render();
    },
    'refresh-directory': async (button) => {
      button.disabled = true;
      try {
        await refreshDirectory();
        render();
        toast('Directory refreshed');
      } catch (error) {
        window.nijiDirectoryError = error.message || String(error);
        render();
        throw error;
      }
    },
    'archive-subject': async (b) => { updateLocal((u) => { u.subjects.find((s) => s.id === b.dataset.id).archived = true; }); toast('Subject archived'); render(); },
    'restore-subject': async (b) => { updateLocal((u) => { u.subjects.find((s) => s.id === b.dataset.id).archived = false; }); state.showArchived = true; render(); },
    'del-class': async (b) => { updateLocal((u) => { u.schedule = u.schedule.filter((c) => c.id !== b.dataset.id); }); render(); },
    'del-subject': async (b) => {
      if (!confirm('Delete this subject permanently? If you may need it later, archive it instead.')) return;
      state.showArchived = !!document.querySelector('[data-archived-details]')?.open;
      updateLocal((u) => { u.subjects = u.subjects.filter((s) => s.id !== b.dataset.id); });
      render();
    },
    'remove-prof': async (b) => { updateLocal((u) => { const s = u.subjects.find((x) => x.id === b.dataset.id); s.facultyId = ''; s.professorEmail = null; }); render(); },
    assign: async (b) => {
      const search = b.parentElement.querySelector('[data-professor-id]');
      const v = search.value;
      if (!v) return toast('Search for and select a professor first.');
      updateLocal((u) => { const s = u.subjects.find((x) => x.id === b.dataset.id); s.facultyId = v; s.professorEmail = null; });
      render();
    },
    'select-professor': (b) => {
      const search = b.closest('[data-professor-search]');
      search.querySelector('[data-professor-query]').value = b.dataset.name;
      search.querySelector('[data-professor-id]').value = b.dataset.id;
      search.querySelector('[data-professor-results]').hidden = true;
      search.querySelector('[data-professor-query]').setAttribute('aria-expanded', 'false');
    },
    chip: (b) => { state.filter = b.dataset.value; render(); },
  };

  const H = {
    search: (f) => { state.query = fd(f).q.trim(); state.filter = 'all'; location.hash = '#directory'; },
    'add-class': async (f) => {
      const d = fd(f);
      if (d.end <= d.start) { f.elements.end.setCustomValidity('End time must be after start time.'); return f.elements.end.reportValidity(); }
      updateLocal((u) => { (u.schedule = u.schedule || []).push({ id: uid(), subject: d.subject.trim(), room: d.room.trim(), start: d.start, end: d.end, dayOfWeek: Number(d.dayOfWeek) || 0 }); });
      toast('Class added'); render();
    },
    'add-subject': async (f) => {
      const d = fd(f);
      if (f.querySelector('[data-professor-query]').value.trim() && !d.prof) {
        return toast('Select a professor from the name search results, or clear the search to leave it unassigned.');
      }
      updateLocal((u) => { (u.subjects = u.subjects || []).push({ id: uid(), name: d.name.trim(), facultyId: d.prof || '', professorEmail: null }); });
      toast('Subject added'); render();
    },
    status: async (f) => {
      if (!me.facultyApproved) throw new Error('Status changes are locked until your account is approved.');
      const d = fd(f);
      await update((u) => {
        u.status = { ...u.status, state: STATUSES[d.state] ? d.state : 'away' };
        u.statusMessage = String(d.statusMessage || '').trim();
      });
      f.closest('[data-modal]').close(); toast('Status and message updated'); render();
    },
    'delete-account': async (f) => {
      const btn = f.querySelector('button:not([type])'); btn.disabled = true;
      const r = await deleteAccount(fd(f));
      if (r.error) { const e = f.querySelector('[data-err]'); e.textContent = r.error; e.classList.remove('hidden'); btn.disabled = false; return; }
      location.replace('index.html');
    },
    profile: async (f) => {
      const d = fd(f);
      await update((u) => {
        u.lastName = d.lastName.trim();
        u.firstName = d.firstName.trim();
        u.middleName = d.middleName.trim();
        u.name = displayName(u);
        u.institution = d.institution.trim();
        if (u.role === 'professor') u.department = d.department.trim();
      });
      toast('Profile saved'); render();
    },
  };

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || !A[b.dataset.action]) return;
    try {
      await A[b.dataset.action](b);
    } catch (error) {
      console.error('Dashboard action failed:', error);
      const message = error.message || error;
      toast(b.dataset.action === 'confirm-logout' ? message : `Could not save: ${message}`);
    }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-form]');
    if (!f || !H[f.dataset.form]) return;
    e.preventDefault();
    try {
      await H[f.dataset.form](f);
    } catch (error) {
      console.error('Dashboard form submission failed:', error);
      toast(`Could not save: ${error.message || error}`);
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.setCustomValidity) e.target.setCustomValidity('');
    if (e.target.id === 'dir-q') { state.query = e.target.value; fillDir(); }
    if (e.target.matches('[data-professor-query]')) {
      const input = e.target;
      const search = input.closest('[data-professor-search]');
      const results = search.querySelector('[data-professor-results]');
      const query = input.value.trim().toLocaleLowerCase();
      search.querySelector('[data-professor-id]').value = '';
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (!query) {
        results.innerHTML = `<p class="px-3 py-2 text-[12px] ${UI.muted}">Type a professor's name to search.</p>`;
        return;
      }
      const matches = professors().filter((professor) => displayName(professor).toLocaleLowerCase().includes(query));
      results.innerHTML = matches.length
        ? matches.map((professor) => `<button type="button" role="option" data-action="select-professor" data-id="${esc(professor.appwriteUserId)}" data-name="${esc(displayName(professor))}" class="block w-full px-3 py-2 text-left text-[13px] ${UI.strong} hover:bg-[#004687]/10"><span class="block">${esc(displayName(professor))}</span><span class="block text-[11px] font-light ${UI.muted}">${esc(professor.department || 'College/faculty not provided')}</span></button>`).join('')
        : `<p class="px-3 py-2 text-[12px] ${UI.muted}">No professors found by that name.</p>`;
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'dir-college') { state.college = e.target.value; fillDir(); }
    if (e.target.id === 'dir-sort') { state.sort = e.target.value; fillDir(); }
  });
  $('#logout-btn').addEventListener('click', logoutModal);

  // ---------- render ----------
  function render() {
    const prof = me.role === 'professor';
    const nav = [
      ['home', 'Home', 'Home', 'home'],
      [prof ? 'schedule' : 'subjects', prof ? 'My Schedule' : 'My Subjects', prof ? 'Schedule' : 'Subjects', 'cal'],
      ['directory', 'Faculty Directory', 'Directory', 'users'],
      ['profile', 'Profile', 'Profile', 'user'],
    ];
    const hash = location.hash.slice(1);
    const key = nav.some((n) => n[0] === hash) ? hash : 'home';
    $('#sidenav').innerHTML = nav.map(([k, label, , ic]) => `<a href="#${k}" class="flex items-center gap-3 px-3 h-10 rounded-[8px] ${k === key ? 'font-semibold bg-[#f5a623] text-[#172033]' : 'text-[#cbd5e1] hover:text-white'}">${svg(ic)}${label}</a>`).join('');
    $('#tabbar').innerHTML = nav.map(([k, , short, ic]) => `<a href="#${k}" class="flex flex-col items-center gap-0.5 py-2 text-[11px] ${k === key ? 'font-semibold text-[#004687] dark:text-[#f5a623]' : UI.muted}">${svg(ic)}${short}</a>`).join('');
    $('#hdr-avatar').innerHTML = avatar(displayName(me), 36);
    $('#hdr-name').textContent = displayName(me);
    $('#hdr-role').textContent = prof ? `Faculty · ${me.department}` : `Student · ${me.institution}`;
    $('#view').innerHTML = `${approvalNotice(me)}${V[key](me)}`;
    if (key === 'directory') fillDir();
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  render();
  document.documentElement.style.visibility = 'visible';
  window.setInterval(async () => {
    try {
      const refreshedUser = await verifyCurrentUser();
      if (!refreshedUser) return redirectTo('index.html');
      if (!refreshedUser.profileComplete) {
        return redirectTo(refreshedUser.role === 'professor' ? 'professor-onboarding.html' : 'onboarding.html');
      }
      const wasApproved = me.facultyApproved;
      me = refreshedUser;
      await refreshDirectory();
      const refreshedMe = loadDb().users.find((user) => user.appwriteUserId === me.appwriteUserId);
      if (refreshedMe) me = refreshedMe;
      if (location.hash.slice(1) === 'directory' || me.role === 'student' ||
          (me.role === 'professor' && wasApproved !== me.facultyApproved)) render();
    } catch (error) {
      console.error('Could not refresh the faculty directory:', error);
    }
  }, 30000);
})();
