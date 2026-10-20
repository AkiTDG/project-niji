// Niji — shared profile data + UI helpers.
const DB_KEY = 'fms-db';
const LOCAL_DATA_KEY = 'niji-local-profile-data';
const PENDING_SIGNUP_KEY = 'niji-pending-signup';
const EXISTING_ACCOUNT_MESSAGE = 'This account already exists. Log-in instead.';
const ACCOUNT_DOES_NOT_EXIST_MESSAGE = 'Account does not exist. Please sign up before logging in.';
const DIRECTORY_MODE = 'approved-professors-storage-messages-v5';
const APPROVAL_MODE = 'appwrite-team-membership-v2';

const STATUSES = {
  available: { label: 'Available', desc: 'Inside the campus and can be approached by students for concerns.', color: '#16a34a' },
  'on-class': { label: 'On Class', desc: 'Inside the campus and currently lecturing a class/section (Zoom or Google Meet classes count here too).', color: '#2563eb' },
  'in-meeting': { label: 'In Meeting', desc: 'Inside the campus and in a meeting session (e.g. a program or a Zoom meeting).', color: '#d97706' },
  dnd: { label: 'Do Not Disturb', desc: 'Inside the campus but not accommodating student concerns right now.', color: '#dc2626' },
  away: { label: 'Away', desc: 'Outside the campus.', color: '#6b7280' },
};

// ICCT college/program reference data (source: icct.edu.ph/bachelor-degree-programs/ and icct.edu.ph/programs/).
// Institution is fixed to ICCT for now, per the current scope.
const ICCT_PROGRAMS = {
  'College of Arts & Sciences': [
    'Bachelor of Arts in Communication (Masscom)',
    'Bachelor of Arts in English',
    'Bachelor of Science in Mathematics',
    'Bachelor of Science in Psychology',
  ],
  'College of Business & Accountancy': [
    'Associate in Business Administration',
    'Bachelor of Science in Accounting Information System',
    'Bachelor of Science in Accountancy',
    'Bachelor of Science in Management Accounting',
    'Bachelor of Science in Real Estate Management',
    'Bachelor of Science in Internal Auditing',
    'Bachelor of Science in Legal Management',
    'Bachelor of Science in Business Administration',
  ],
  'College of Computer Studies': [
    'Associate in Computer Technology',
    'Bachelor of Science in Computer Science',
    'Bachelor of Science in Information Technology',
    'Bachelor of Science in Information System',
  ],
  'College of Teacher Education': [
    'Bachelor in Early Childhood Education',
    'Bachelor in Elementary Education',
    'Bachelor in Secondary Education',
    'Bachelor in Technical Vocational Teacher Education',
    'Certificate in Teaching Program',
  ],
  'College of Criminology & Administration': [
    'Bachelor of Science in Criminology',
    'Bachelor of Science in Industrial Security Management',
    'Bachelor in Public Administration',
  ],
  'College of Engineering & Digital Technology': [
    'Bachelor of Science in Computer Engineering',
    'Bachelor of Science in Electronics Engineering',
  ],
  'College of Health Sciences': [
    'Bachelor of Science in Medical Technology',
    'Bachelor of Science in Nursing',
    'Bachelor of Science in Radiologic Technology',
    'Diploma in Health Care & Wellness Associate',
  ],
  'International School of Hospitality & Tourism Management': [
    'Bachelor of Science in Hospitality Management',
    'Bachelor of Science in Tourism Management',
    'Diploma in Hotel & Restaurant Management-1',
    'Diploma in Hotel & Restaurant Management-2',
  ],
};
const ICCT_COLLEGES = Object.keys(ICCT_PROGRAMS);

// ---------- helpers ----------
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// ---------- Appwrite data layer ----------
const nijiAccount = () => window.nijiAppwrite.account;
const nijiConfig = () => window.nijiAppwrite.config;
let dbCache = { users: [] };
let activeUserId = '';

function dataFunctionId() {
  const config = nijiConfig();
  if (!config?.dataFunctionId) {
    throw new Error('Appwrite setup is incomplete. Configure dataFunctionId in appwrite-config.js.');
  }
  return config.dataFunctionId;
}

function loadDb() {
  return dbCache;
}

const saveDb = (db) => { dbCache = db; };

function clearIdentityCache() {
  activeUserId = '';
  dbCache = { users: [] };
  window.nijiCurrentUserId = '';
  window.nijiCurrentUser = null;
}

async function clearRoleMismatchSession(error, provider) {
  if (!/^This account is registered as a (student|professor)\./.test(error?.message || '')) {
    return null;
  }
  try {
    await nijiAccount().deleteSession({ sessionId: 'current' });
  } catch (sessionError) {
    if (sessionError?.code !== 401) {
      console.error(`${provider} session for a role-mismatched account could not be ended:`, sessionError);
      clearIdentityCache();
      return {
        error: `${error.message} The ${provider} session could not be ended; log out before continuing.`,
      };
    }
  }
  clearIdentityCache();
  return { error: error.message };
}

async function prepareAccountSwitch(target) {
  let currentUser;
  try {
    currentUser = await nijiAccount().get();
  } catch (error) {
    if (error?.code === 401) return true;
    throw error;
  }

  const currentEmail = currentUser.email || 'the current account';
  const isDashboard = /(?:^|\/)dashboard\.html$/.test(location.pathname);
  if (isDashboard && !window.confirm(
    `You are signed in as ${currentEmail}. To continue with ${target}, Niji must sign out this account first. Continue?`
  )) return false;

  await nijiAccount().deleteSession({ sessionId: 'current' });
  clearIdentityCache();
  return true;
}

async function trustedWrite(action, data) {
  const functionId = dataFunctionId();
  let execution;
  try {
    execution = await window.nijiAppwrite.functions.createExecution({
      functionId,
      body: JSON.stringify({ action, data }),
      async: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    throw new Error(`The secure Appwrite data function could not be called: ${appwriteError(error)}`);
  }
  let response;
  try {
    response = execution.responseBody ? JSON.parse(execution.responseBody) : {};
  } catch (error) {
    console.error('The Appwrite data function returned a non-JSON response:', error);
    throw new Error('The secure Appwrite data function returned an invalid response.');
  }
  if (execution.status !== 'completed' || execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    const executionId = execution.$id || execution.id;
    if (action === 'delete-account' && response.error === 'Unsupported data action.') {
      throw new Error('Account deletion is not enabled on the deployed Appwrite Function. Redeploy files/appwrite-functions/data-api with the updated source.');
    }
    if (action === 'delete-incomplete-signup' && response.error === 'Unsupported data action.') {
      throw new Error('Sign-up rollback is not enabled on the deployed Appwrite Function. Redeploy files/appwrite-functions/data-api with the updated source.');
    }
    if (execution.responseStatusCode === 503) {
      console.error('The Appwrite data function is unavailable:', {
        executionId,
        status: execution.status,
        errors: execution.errors,
      });
      throw new Error(`The Appwrite data function is unavailable (503). Check its deployment, runtime logs, and required environment variables${executionId ? ` (execution ${executionId})` : ''}.`);
    }
    console.error('The Appwrite data function returned an error:', {
      executionId,
      action,
      status: execution.status,
      responseStatusCode: execution.responseStatusCode,
      response: response.error || '',
      errors: execution.errors,
    });
    if (execution.responseStatusCode === 401) {
      const authError = new Error(`Appwrite rejected the secure data request (401). Check the Function's authenticated-user Execute access and user JWT forwarding${executionId ? ` (execution ${executionId})` : ''}.`);
      authError.code = 401;
      throw authError;
    }
    if (execution.responseStatusCode >= 500) {
      throw new Error(`The Appwrite data function failed (${execution.responseStatusCode}). Check its runtime logs and environment variables${executionId ? ` (execution ${executionId})` : ''}.`);
    }
    throw new Error(response.error || `The Appwrite data function failed (${execution.responseStatusCode || execution.status}).`);
  }
  return response;
}

async function checkAccountExists(email) {
  let execution;
  try {
    execution = await window.nijiAppwrite.functions.createExecution({
      functionId: dataFunctionId(),
      body: JSON.stringify({ action: 'account-exists', data: { email } }),
      async: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    throw new Error(`Could not check whether the account exists: ${appwriteError(error)}`);
  }

  let response;
  try {
    response = execution.responseBody ? JSON.parse(execution.responseBody) : {};
  } catch (error) {
    console.error('The Appwrite account check returned a non-JSON response:', error);
    throw new Error('The account check returned an invalid response.');
  }
  if (execution.status !== 'completed' || execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
    console.error('The Appwrite account check failed:', {
      executionId: execution.$id || execution.id,
      status: execution.status,
      responseStatusCode: execution.responseStatusCode,
      errors: execution.errors,
    });
    throw new Error('Could not check whether the account exists. Please try again.');
  }
  if (typeof response.exists !== 'boolean') {
    throw new Error('The account check returned an invalid response.');
  }
  return response.exists;
}

function legacyDb() {
  try {
    const legacy = JSON.parse(localStorage.getItem(DB_KEY));
    return legacy && Array.isArray(legacy.users) ? legacy : { users: [] };
  } catch (error) {
    console.warn('Legacy local profile data could not be read for migration:', error);
    return { users: [] };
  }
}

function removeMigratedLegacy(userId) {
  const legacy = legacyDb();
  legacy.users = legacy.users.filter((user) => user.appwriteUserId !== userId);
  if (legacy.users.length) localStorage.setItem(DB_KEY, JSON.stringify(legacy));
  else localStorage.removeItem(DB_KEY);
}

function localProfileData(userId) {
  const stored = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
  const profile = stored[userId];
  return profile && typeof profile === 'object' ? profile : { schedule: [], subjects: [] };
}

function hasLocalProfileData(userId) {
  const stored = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
  return Object.hasOwn(stored, userId);
}

function saveLocalProfileData(user) {
  const stored = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
  stored[user.appwriteUserId] = {
    schedule: user.schedule || [],
    subjects: user.subjects || [],
    provider: user.provider || 'password',
  };
  localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(stored));
}

function legacyFor(authUser) {
  return legacyDb().users.find((user) => !user.seed && user.appwriteUserId === authUser.$id) || null;
}

function validText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validStatus(value) {
  return Object.hasOwn(STATUSES, value) ? value : 'away';
}

function normalizeLegacySchedule(schedule, userId) {
  if (!Array.isArray(schedule)) return [];
  return schedule.flatMap((item, index) => {
    const start = validText(item?.start, 5);
    const end = validText(item?.end, 5);
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) return [];
    const id = `${userId.slice(0, 10)}_s${index}`;
    return [{
      $id: id,
      id,
      facultyId: userId,
      subject: validText(item.subject, 60),
      room: validText(item.room, 20),
      start,
      end,
      dayOfWeek: Number.isInteger(item.dayOfWeek) && item.dayOfWeek >= 0 && item.dayOfWeek <= 7 ? item.dayOfWeek : 0,
    }];
  }).filter((item) => item.subject);
}

function normalizeLegacySubjects(subjects, userId, facultyByEmail) {
  if (!Array.isArray(subjects)) return [];
  return subjects.flatMap((item, index) => {
    const name = validText(item?.name, 60);
    if (!name) return [];
    const id = `${userId.slice(0, 10)}_u${index}`;
    return [{
      $id: id,
      id,
      userId,
      name,
      facultyId: facultyByEmail.get(validText(item.professorEmail, 320).toLowerCase()) || '',
      archived: item.archived === true,
    }];
  });
}

async function loadUserData(authUser, providerHint = '', requestedRole = '', requireExistingProfile = false, rejectExistingProfile = false) {
  if (!authUser?.$id || !authUser.email) {
    throw new Error('Appwrite did not return a valid authenticated account.');
  }
  dataFunctionId();
  const userId = authUser.$id;
  const legacy = legacyFor(authUser);
  const localData = localProfileData(userId);
  const provider = providerHint || (localData.provider === 'google' ? 'google' : 'password');
  const loaded = await trustedWrite('load-user-data', {
    provider,
    requestedRole,
    requireExistingProfile,
    rejectExistingProfile,
    legacyProfile: legacy,
  });
  const profile = loaded.profile;
  if (!profile) throw new Error('The Appwrite profile could not be loaded.');
  const isFaculty = loaded.role === 'professor';
  let user = {
    appwriteUserId: userId,
    email: authUser.email.toLowerCase(),
    provider,
    role: isFaculty ? 'professor' : 'student',
    name: [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' '),
    firstName: profile.first_name || '',
    middleName: profile.middle_name || '',
    lastName: profile.last_name || '',
    institution: profile.college || '',
    department: isFaculty ? profile.faculty || '' : '',
    course: isFaculty ? '' : profile.course || '',
    linkedGoogleEmail: '',
    profileComplete: profile.profileComplete === true,
    verificationStatus: loaded.verificationStatus || profile.verificationStatus || profile.verification_status || 'approved',
    facultyApproved: loaded.approvalMode === APPROVAL_MODE && loaded.facultyApproved === true,
    emailVerified: loaded.emailVerified === true,
    isAdmin: loaded.isAdmin === true,
    status: isFaculty
      ? { state: validStatus(profile.status?.state), updatedAt: profile.status?.updatedAt || null }
      : { state: 'away', note: '', updatedAt: null },
    statusMessage: isFaculty ? validText(profile.statusMessage, 240) : '',
    schedule: localData.schedule || [],
    subjects: localData.subjects || [],
  };

  if (legacy && !hasLocalProfileData(userId)) {
    if (isFaculty) {
      user.schedule = normalizeLegacySchedule(legacy.schedule, userId);
    } else {
      const { directory: facultyDirectory } = await trustedWrite('directory', {});
      const facultyByEmail = new Map(facultyDirectory.map((faculty) => [faculty.email.toLowerCase(), faculty.appwriteUserId]));
      user.subjects = normalizeLegacySubjects(legacy.subjects, userId, facultyByEmail);
    }
    saveLocalProfileData(user);
  }
  if (!hasLocalProfileData(userId)) saveLocalProfileData(user);
  if (legacy) removeMigratedLegacy(userId);
  activeUserId = userId;
  dbCache = { users: [user] };
  window.nijiCurrentUserId = userId;
  window.nijiCurrentUser = user;
  return user;
}

async function saveCurrentUserData(user) {
  if (!user?.appwriteUserId || (activeUserId && user.appwriteUserId !== activeUserId)) {
    throw new Error('The profile does not belong to the currently authenticated account.');
  }
  const userId = user.appwriteUserId;
  const isFaculty = user.role === 'professor';
  const firstName = validText(user.firstName, 80);
  const middleName = validText(user.middleName, 80);
  const lastName = validText(user.lastName, 80);
  if (user.profileComplete && (!firstName || !lastName || !validText(user.institution, 100) ||
      !validText(isFaculty ? user.department : user.course, isFaculty ? 150 : 200))) {
    throw new Error('Complete all required profile fields before saving.');
  }
  const response = await trustedWrite('save-profile', {
    profile: {
      ...(firstName || middleName || lastName ? { firstName, middleName, lastName } : {}),
      college: validText(user.institution, 100),
      course: isFaculty ? '' : validText(user.course, 200),
      faculty: isFaculty ? validText(user.department, 150) : '',
      profileComplete: user.profileComplete === true,
    },
    statusMessage: isFaculty ? validText(user.statusMessage, 240) : '',
    status: isFaculty ? {
      state: validStatus(user.status?.state),
      expectedUpdatedAt: user.expectedStatusUpdatedAt || user.status?.updatedAt || null,
    } : null,
  });
  const saved = {
    ...user,
    role: response.role || user.role,
    profileComplete: response.profile.profileComplete === true,
    verificationStatus: response.verificationStatus || response.profile.verificationStatus || user.verificationStatus,
    facultyApproved: response.approvalMode === APPROVAL_MODE && response.facultyApproved === true,
    statusMessage: isFaculty ? validText(response.profile.statusMessage, 240) : '',
    status: response.status
      ? { state: validStatus(response.status.state), updatedAt: response.status.updatedAt }
      : user.status,
    expectedStatusUpdatedAt: response.status?.updatedAt || null,
  };
  saveLocalProfileData(saved);
  dbCache.users = dbCache.users.filter((entry) => entry.appwriteUserId !== userId);
  dbCache.users.push(saved);
  window.nijiCurrentUser = saved;
  return saved;
}

async function refreshDirectory() {
  const response = await trustedWrite('directory', {});
  if (!Array.isArray(response.directory)) {
    throw new Error('The Appwrite Function returned an invalid faculty directory response.');
  }
  const currentFunction = response.directoryMode === DIRECTORY_MODE && response.approvalMode === APPROVAL_MODE;
  if (!currentFunction) {
    dbCache.users = dbCache.users.filter((user) => user.appwriteUserId === activeUserId);
    window.nijiDirectoryOutdated = true;
    window.nijiStatusMessagesEnabled = false;
    window.nijiDirectoryError = 'The deployed Appwrite Function does not enforce professor approval. Deploy the latest data-api Function before using the faculty directory.';
    throw new Error(window.nijiDirectoryError);
  }
  const users = response.directory;
  window.nijiDirectoryMode = response.directoryMode || 'legacy-filtered';
  window.nijiDirectoryOutdated = false;
  window.nijiStatusMessagesEnabled = true;
  const mappedUsers = users.map((user) => ({
    ...user,
    statusMessage: validText(user.statusMessage, 240),
    schedule: [],
    subjects: [],
  }));
  dbCache.users = [
    ...dbCache.users.filter((user) => user.appwriteUserId === activeUserId),
    ...mappedUsers.filter((user) => user.appwriteUserId !== activeUserId),
  ];
  window.nijiDirectoryError = '';
  return mappedUsers;
}

function appwriteError(error) {
  if (error?.message === 'Invalid `email` param: Value must be a valid email address') {
    return 'Value must be a valid email address';
  }
  return error?.message || 'Authentication failed. Please try again.';
}

async function completeSignup({ email, password, requestedRole, profile }) {
  email = String(email).trim().toLowerCase();
  const role = requestedRole === 'professor' ? 'professor' : 'student';
  let accountCreated = false;
  let sessionCreated = false;
  let profileSaved = false;

  try {
    try {
      await nijiAccount().get();
      return { error: 'Log out before creating a new account.' };
    } catch (error) {
      if (error?.code !== 401) throw error;
    }

    let appwriteUser;
    try {
      appwriteUser = await nijiAccount().create({
        userId: Appwrite.ID.unique(),
        email,
        password,
        name: validText(profile.name, 80),
      });
      accountCreated = true;
    } catch (error) {
      if (error?.code === 409) return { error: EXISTING_ACCOUNT_MESSAGE };
      throw error;
    }

    await nijiAccount().createEmailPasswordSession({ email, password });
    sessionCreated = true;
    appwriteUser = await nijiAccount().get();

    await trustedWrite('save-profile', {
      profile: {
        firstName: validText(profile.firstName, 80),
        middleName: validText(profile.middleName, 80),
        lastName: validText(profile.lastName, 80),
        college: validText(profile.institution, 100),
        course: role === 'professor' ? '' : validText(profile.course, 200),
        faculty: role === 'professor' ? validText(profile.department, 150) : '',
        requestedRole: role,
        profileComplete: true,
      },
      status: { state: 'away', expectedUpdatedAt: null },
    });
    profileSaved = true;

    sessionStorage.removeItem(PENDING_SIGNUP_KEY);
    const user = await loadUserData(appwriteUser, 'password');
    return { user };
  } catch (error) {
    console.error('Appwrite account completion failed:', error);

    if (accountCreated && sessionCreated && !profileSaved) {
      const cleanup = await discardIncompleteSignup();
      if (cleanup.error) {
        return {
          error: `Could not finish sign-up: ${appwriteError(error)}. The incomplete account could not be removed: ${cleanup.error}`,
        };
      }
    }

    return {
      error: profileSaved
        ? 'Your account was created, but its profile could not be loaded. Please log in.'
        : appwriteError(error),
    };
  }
}

async function discardIncompleteSignup() {
  try {
    await trustedWrite('delete-incomplete-signup', {});
    activeUserId = '';
    dbCache = { users: [] };
    window.nijiCurrentUserId = '';
    window.nijiCurrentUser = null;
    return { deleted: true };
  } catch (error) {
    console.error('Incomplete Appwrite signup could not be rolled back:', error);
    return { error: appwriteError(error) };
  }
}

async function loginUser({ email, password, provider, role }) {
  email = String(email).trim().toLowerCase();
  let credentialsRejected = false;
  try {
    if (provider === 'password') {
      const switched = await prepareAccountSwitch(email);
      if (!switched) return { error: 'Sign-in cancelled. Your current session was kept.' };
      try {
        await nijiAccount().createEmailPasswordSession({ email, password });
      } catch (error) {
        credentialsRejected = error?.code === 401;
        throw error;
      }
    }
    const appwriteUser = await nijiAccount().get();
    if (appwriteUser.email?.toLowerCase() !== email) {
      return { error: 'The authenticated account email did not match the submitted email.' };
    }
    return {
      user: await loadUserData(appwriteUser, provider, role, true),
    };
  } catch (error) {
    console.error('Appwrite login failed:', error);
    const roleMismatch = await clearRoleMismatchSession(error, 'password');
    if (roleMismatch) return roleMismatch;
    if (error?.message === ACCOUNT_DOES_NOT_EXIST_MESSAGE) {
      try {
        await nijiAccount().deleteSession({ sessionId: 'current' });
      } catch (sessionError) {
        console.error('Session for an unregistered account could not be ended:', sessionError);
        clearIdentityCache();
        return {
          error: 'No account exists for this email. Please sign up first.',
        };
      }
      clearIdentityCache();
      return { error: 'No account exists for this email. Please sign up first.' };
    }
    if (credentialsRejected) {
      return {
        error: 'No account was found with those sign-in details. If you have not signed up yet, create an account; otherwise, check your password.',
      };
    }
    return { error: appwriteError(error) };
  }
}

async function loginGoogleUser({ requestedRole, expectedUserId, isSignup = false }) {
  clearIdentityCache();
  try {
    const appwriteUser = await nijiAccount().get();
    if (expectedUserId && appwriteUser.$id !== expectedUserId) {
      return {
        error: 'The authenticated Appwrite account did not match the Google OAuth response. Please start Google sign-in again.',
        retryable: false,
      };
    }
    if (!appwriteUser.email) {
      return { error: 'Appwrite did not return an email for the authenticated Google account.', retryable: false };
    }
    const identities = await nijiAccount().listIdentities();
    const googleIdentity = identities.identities.find((identity) =>
      identity.provider === 'google' && identity.userId === appwriteUser.$id
    );
    if (!googleIdentity?.providerEmail ||
        googleIdentity.providerEmail.trim().toLowerCase() !== appwriteUser.email.trim().toLowerCase()) {
      console.error('Google OAuth identity does not match the authenticated Appwrite account:', {
        appwriteUserId: appwriteUser.$id,
        appwriteEmail: appwriteUser.email,
        googleProviderEmail: googleIdentity?.providerEmail || '',
      });
      try {
        await nijiAccount().deleteSession({ sessionId: 'current' });
      } catch (error) {
        console.error('Mismatched Google OAuth session could not be invalidated:', error);
        clearIdentityCache();
        return {
          error: 'Google authenticated to an Appwrite account with a different email address, and that session could not be safely cleared. Please log out before continuing.',
          retryable: false,
        };
      }
      clearIdentityCache();
      return {
        error: 'Google authenticated to an Appwrite account with a different email address. No Niji profile was loaded. Sign out of Appwrite, then try again with the intended Google account.',
        retryable: false,
      };
    }
    if (isSignup && !['student', 'professor'].includes(requestedRole)) {
      return { error: 'The selected account role was not valid.', retryable: false };
    }
    return {
      user: await loadUserData(appwriteUser, 'google', requestedRole, !isSignup, isSignup),
    };
  } catch (error) {
    console.error('Appwrite Google profile initialization failed:', error);
    const roleMismatch = await clearRoleMismatchSession(error, 'Google');
    if (roleMismatch) return { ...roleMismatch, retryable: false };
    if (isSignup && error?.message === EXISTING_ACCOUNT_MESSAGE) {
      try {
        await nijiAccount().deleteSession({ sessionId: 'current' });
      } catch (sessionError) {
        if (sessionError?.code !== 401) {
          console.error('Google sign-up session for an existing account could not be ended:', sessionError);
          clearIdentityCache();
          return {
            error: `${EXISTING_ACCOUNT_MESSAGE} The Google session could not be ended; log out before continuing.`,
            retryable: false,
          };
        }
      }
      clearIdentityCache();
      return { error: EXISTING_ACCOUNT_MESSAGE, retryable: false };
    }
    if (error?.message === ACCOUNT_DOES_NOT_EXIST_MESSAGE) {
      try {
        await nijiAccount().deleteSession({ sessionId: 'current' });
      } catch (sessionError) {
        console.error('Google session for an unregistered account could not be ended:', sessionError);
        clearIdentityCache();
        return {
          error: 'No Niji account exists for this Google account. Sign up first. The Google session could not be ended automatically; log out before continuing.',
          retryable: false,
        };
      }
      clearIdentityCache();
      return { error: 'No Niji account exists for this Google account. Please sign up first.', retryable: false };
    }
    return {
      error: `Google sign-in succeeded, but your Niji profile could not be initialized: ${appwriteError(error)}`,
      retryable: error?.code !== 401,
    };
  }
}

async function currentUser() {
  try {
    return await loadUserData(await nijiAccount().get());
  } catch (error) {
    if (error?.code === 401) return null;
    console.error('Could not retrieve the current Appwrite user:', error);
    throw error;
  }
}

async function updateCurrentUser(fn) {
  if (!activeUserId) throw new Error('No authenticated user is available to update.');
  const current = dbCache.users.find((user) => user.appwriteUserId === activeUserId);
  if (!current) throw new Error('The current Appwrite profile has not been loaded.');
  const updated = structuredClone(current);
  fn(updated);
  updated.expectedStatusUpdatedAt = current.status?.updatedAt || null;
  return await saveCurrentUserData(updated);
}

function updateLocalUserData(fn) {
  if (!activeUserId) throw new Error('No authenticated user is available to update.');
  const current = dbCache.users.find((user) => user.appwriteUserId === activeUserId);
  if (!current) throw new Error('The current Appwrite profile has not been loaded.');
  const updated = structuredClone(current);
  fn(updated);
  saveLocalProfileData(updated);
  dbCache.users = dbCache.users.filter((user) => user.appwriteUserId !== activeUserId);
  dbCache.users.push(updated);
  window.nijiCurrentUser = updated;
  return updated;
}

function linkGoogleAccount() {
  return { error: 'Google account linking is not available through the current Appwrite OAuth flow.' };
}

function unlinkGoogleAccount() {
  return { error: 'Google account linking is not available through the current Appwrite OAuth flow.' };
}
async function logout() {
  const logoutButton = document.getElementById('logout-btn') || document.getElementById('ob-logout');
  if (logoutButton?.disabled) return;
  if (logoutButton) logoutButton.disabled = true;

  try {
    await nijiAccount().deleteSession('current');
  } catch (error) {
    if (error?.code !== 401) {
      console.error('Appwrite logout failed:', error);
      if (logoutButton) logoutButton.disabled = false;
      throw new Error(`Could not log out: ${appwriteError(error)}`);
    }
  }

  clearIdentityCache();
  sessionStorage.removeItem(PENDING_SIGNUP_KEY);
  sessionStorage.removeItem(OAUTH_PENDING_KEY);
  window.location.replace('index.html');
}

window.nijiAuth = {
  completeSignup,
  discardIncompleteSignup,
  clearPendingSignup: () => sessionStorage.removeItem(PENDING_SIGNUP_KEY),
  loginUser,
  loginGoogleUser,
  prepareAccountSwitch,
  clearIdentityCache,
  linkGoogleAccount,
  refreshDirectory,
};

function clearDeletedAccountLocalData(userId) {
  try {
    const raw = localStorage.getItem(LOCAL_DATA_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        throw new Error('Stored local profile data has an invalid format.');
      }
      delete stored[userId];
      if (Object.keys(stored).length) localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(stored));
      else localStorage.removeItem(LOCAL_DATA_KEY);
    }
  } catch (error) {
    console.error('Deleted account local profile data could not be cleared:', error);
  }

  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return;
    const legacy = JSON.parse(raw);
    if (!legacy || !Array.isArray(legacy.users)) {
      throw new Error('Stored legacy profile data has an invalid format.');
    }
    legacy.users = legacy.users.filter((user) => user.appwriteUserId !== userId);
    if (legacy.users.length) localStorage.setItem(DB_KEY, JSON.stringify(legacy));
    else localStorage.removeItem(DB_KEY);
  } catch (error) {
    console.error('Deleted account legacy profile data could not be cleared:', error);
  }
}

async function deleteAccount({ confirmEmail }) {
  try {
    await trustedWrite('delete-account', { confirmEmail });
    const userId = activeUserId;
    clearDeletedAccountLocalData(userId);
    activeUserId = '';
    dbCache = { users: [] };
    window.nijiCurrentUser = null;
    return { deleted: true };
  } catch (error) {
    console.error('Appwrite account deletion failed:', error);
    return { error: appwriteError(error) };
  }
}

// ---------- UI helpers ----------
const UI = {
  input: 'w-full h-10 rounded-[7px] border border-[#475569] dark:border-[#9ca3af] bg-[#f9f6ee] dark:bg-[#2f2f2f] px-3 text-[14px] text-[#1e1e1e] dark:text-[#f8f4e8] outline-none focus:ring-2 focus:ring-[#004687]',
  btn: 'h-10 px-5 rounded-[9px] bg-[#004687] text-[#f8f4e8] text-[14px] font-semibold',
  btnGhost: 'h-10 px-5 rounded-[9px] border border-[#475569] dark:border-[#9ca3af] text-[14px] font-semibold text-[#172033] dark:text-[#f8f4e8]',
  card: 'rounded-[12px] border border-[#475569]/30 dark:border-[#9ca3af]/30 bg-[#f9f6ee] dark:bg-[#2f2f2f] p-5',
  label: 'block text-[12px] font-light text-[#475569] dark:text-[#d1d5db] mb-1',
  muted: 'text-[#475569] dark:text-[#9ca3af]',
  strong: 'text-[#172033] dark:text-[#f8f4e8]',
};

function openModal(html, onClose) {
  const el = document.createElement('div');
  el.dataset.modal = '1';
  el.className = 'fixed inset-0 z-50 grid place-items-center bg-black/60 px-5';
  el.innerHTML = `<div class="w-full max-w-[380px] max-h-[90dvh] overflow-y-auto rounded-[14px] border border-[#475569] dark:border-[#9ca3af] bg-[#f8f4e8] dark:bg-[#2f2f2f] p-5 text-[#172033] dark:text-[#f8f4e8]">${html}</div>`;
  const onKey = (e) => { if (e.key === 'Escape') el.close(); };
  el.close = () => {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  return el;
}
