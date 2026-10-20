// Niji — shared front-end behavior for the auth pages (accounts/data live in store.js).

// --- Theme (light/dark) ---
function initTheme() {
  const saved = localStorage.getItem('fms-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', saved ? saved === 'dark' : prefersDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('fms-theme', isDark ? 'dark' : 'light');
}

// --- Role (student/professor) ---
let currentRole = 'student';

function setRole(role) {
  const indicator = document.getElementById('role-indicator');
  const studentBtn = document.getElementById('role-student');
  const professorBtn = document.getElementById('role-professor');
  const emailField = document.getElementById('email-field');
  const emailLabel = document.getElementById('email-label');
  const emailInput = document.getElementById('email-input');

  const isStudent = role === 'student';
  currentRole = role;

  indicator.style.transform = isStudent ? 'translateX(0)' : 'translateX(100%)';

  studentBtn.setAttribute('aria-pressed', String(isStudent));
  professorBtn.setAttribute('aria-pressed', String(!isStudent));

  studentBtn.classList.toggle('text-[#f8f4e8]', isStudent);
  studentBtn.classList.toggle('text-[#172033]', !isStudent);
  studentBtn.classList.toggle('dark:text-[#9ca3af]', !isStudent);

  professorBtn.classList.toggle('text-[#f8f4e8]', !isStudent);
  professorBtn.classList.toggle('text-[#172033]', isStudent);
  professorBtn.classList.toggle('dark:text-[#9ca3af]', isStudent);

  // Cross-fade the email field while its label/placeholder swap underneath.
  emailField.classList.add('opacity-0');
  window.setTimeout(() => {
    emailLabel.textContent = isStudent ? 'Student Email' : "Professor's Email";
    emailInput.setAttribute('placeholder', isStudent ? 'you@student.edu' : 'you@faculty.edu');
    emailInput.dataset.role = role;
    emailField.classList.remove('opacity-0');
  }, 150);
}

// --- Password visibility toggle ---
function initPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.querySelector('.eye-open').classList.toggle('hidden', !showing);
      btn.querySelector('.eye-closed').classList.toggle('hidden', showing);
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}

// --- Password strength (sign-up only) ---
function getPasswordError(password) {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must include at least one capital letter.';
  if (!/[0-9]/.test(password)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character.';
  return '';
}

function showFormError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

// --- Flowchart routing: after log-in / sign-up, finish the profile step first if needed ---
const onboardingPage = (role) => role === 'professor' ? 'professor-onboarding.html' : 'onboarding.html';
function authDestination(user) {
  if (!user.profileComplete) return onboardingPage(user.role);
  return 'dashboard.html';
}
const goAfterAuth = (user) => { location.replace(authDestination(user)); };

// --- Wire up on load ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initPasswordToggles();

  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const studentBtn = document.getElementById('role-student');
  const professorBtn = document.getElementById('role-professor');
  if (studentBtn && professorBtn) {
    studentBtn.addEventListener('click', () => setRole('student'));
    professorBtn.addEventListener('click', () => setRole('professor'));
  }

  // Log-in / sign-up pages
  const form = document.getElementById('auth-form');
  const passwordInput = document.getElementById('password-input');
  const confirmInput = document.getElementById('confirm-password-input');
  const isSignup = form?.dataset.mode === 'signup';

  if (form) {
    if (!isSignup) {
      const clearPendingSignup = () => sessionStorage.removeItem(PENDING_SIGNUP_KEY);
      clearPendingSignup();
      window.addEventListener('pageshow', clearPendingSignup);
    }
    if (new URLSearchParams(location.search).has('oauth')) return;

    form.addEventListener('input', (e) => {
      showFormError('form-error', '');
      if (e.target.setCustomValidity) e.target.setCustomValidity('');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isSignup) sessionStorage.removeItem(PENDING_SIGNUP_KEY);
      showFormError('form-error', '');
      const email = document.getElementById('email-input').value.trim();
      let result;

      try {
        if (isSignup) {
          const strengthError = getPasswordError(passwordInput.value);
          if (strengthError) {
            passwordInput.setCustomValidity(strengthError);
            return passwordInput.reportValidity();
          }
          if (passwordInput.value !== confirmInput.value) {
            confirmInput.setCustomValidity('Passwords do not match.');
            return confirmInput.reportValidity();
          }
          const switched = await nijiAuth.prepareAccountSwitch('sign-up');
          if (!switched) {
            return showFormError('form-error', 'Sign-up cancelled. Your current session was kept.');
          }
          sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({
            email,
            password: passwordInput.value,
            role: currentRole,
          }));
          location.replace(onboardingPage(currentRole));
          return;
        } else {
          result = await loginUser({ email, password: passwordInput.value, role: currentRole, provider: 'password' });
        }
      } catch (error) {
        console.error('Authentication request failed:', error);
        return showFormError('form-error', error.message || 'Authentication failed. Please try again.');
      }

      if (result.error) return showFormError('form-error', result.error);
      goAfterAuth(result.user);
    });
  }

  // Forgot password page
  const forgotForm = document.getElementById('forgot-form');
  if (forgotForm) {
    const emailInput = document.getElementById('forgot-email');
    const button = forgotForm.querySelector('button[type="submit"]');
    const defaultButtonText = button.textContent;

    forgotForm.addEventListener('input', () => showFormError('forgot-error', ''));
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      emailInput.value = email;
      if (!email) {
        return showFormError('forgot-error', 'Enter your email address.');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showFormError('forgot-error', 'Enter a valid email address.');
      }
      if (button.disabled) return;

      button.disabled = true;
      button.textContent = 'Sending...';
      showFormError('forgot-error', '');
      try {
        if (!await checkAccountExists(email)) {
          showFormError('forgot-error', 'No account exists for this email address.');
          button.textContent = defaultButtonText;
          button.disabled = false;
          return;
        }
        await nijiAccount().createRecovery({
          email,
          url: nijiAppwrite.config.recoveryUrl,
        });
        document.getElementById('forgot-form-wrap').classList.add('hidden');
        document.getElementById('forgot-success').classList.remove('hidden');
      } catch (requestError) {
        console.error('Password recovery request failed:', requestError);
        showFormError('forgot-error', 'We could not process that request right now. Check your connection and try again.');
        button.textContent = defaultButtonText;
        button.disabled = false;
      }
    });
  }

  const recoveryParams = new URLSearchParams(location.search);
  const recoveryUserId = recoveryParams.get('userId');
  const recoverySecret = recoveryParams.get('secret');
  const recoveryForm = document.getElementById('recovery-form');
  const hasRecoveryParams = recoveryParams.has('userId') || recoveryParams.has('secret');
  if (recoveryForm && hasRecoveryParams) {
    const recoveryUrl = new URL(location.href);
    recoveryUrl.search = '';
    window.history.replaceState({}, '', `${recoveryUrl.pathname}${recoveryUrl.hash}`);
    document.getElementById('forgot-heading').textContent = recoveryUserId && recoverySecret
      ? 'Reset your password'
      : 'Reset link unavailable';
    document.getElementById('forgot-description').textContent = recoveryUserId && recoverySecret
      ? 'Enter and confirm a new password for your account.'
      : 'This recovery link is missing information or is invalid.';
    document.getElementById('forgot-form-wrap').classList.add('hidden');
    document.getElementById('forgot-success').classList.add('hidden');
    document.getElementById('invalid-recovery-link').classList.add('hidden');
    document.getElementById('recovery-success').classList.add('hidden');
    if (!recoveryUserId || !recoverySecret) {
      document.getElementById('invalid-recovery-link').classList.remove('hidden');
      return;
    }

    document.getElementById('recovery-form-wrap').classList.remove('hidden');
    const recoveryButton = recoveryForm.querySelector('button[type="submit"]');
    const defaultRecoveryButtonText = recoveryButton.textContent;
    recoveryForm.addEventListener('input', () => {
      showFormError('recovery-error', '');
      document.getElementById('recovery-help').classList.add('hidden');
    });
    recoveryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('recovery-password').value;
      const confirmation = document.getElementById('recovery-confirm-password').value;
      const help = document.getElementById('recovery-help');
      showFormError('recovery-error', '');
      help.classList.add('hidden');
      if (!password || !confirmation) {
        return showFormError('recovery-error', 'Enter and confirm your new password.');
      }
      const passwordError = getPasswordError(password);
      if (passwordError) return showFormError('recovery-error', passwordError);
      if (password !== confirmation) {
        return showFormError('recovery-error', 'Passwords do not match.');
      }
      if (recoveryButton.disabled) return;
      recoveryButton.disabled = true;
      recoveryButton.textContent = 'Resetting...';
      try {
        await nijiAccount().updateRecovery({
          userId: recoveryUserId,
          secret: recoverySecret,
          password,
        });
        document.getElementById('recovery-form-wrap').classList.add('hidden');
        document.getElementById('recovery-success').classList.remove('hidden');
      } catch (requestError) {
        const errorType = String(requestError?.type || '').toLowerCase();
        const errorMessage = `${errorType} ${String(requestError?.message || '')}`.toLowerCase();
        const invalidLink = /invalid.*(token|secret|recovery)|expired|token.*invalid/.test(errorMessage);
        showFormError(
          'recovery-error',
          invalidLink
            ? 'This reset link is invalid or expired. Request a new link to continue.'
            : 'We could not reset your password. Check the password requirements and try again.',
        );
        help.classList.remove('hidden');
        recoveryButton.textContent = defaultRecoveryButtonText;
        recoveryButton.disabled = false;
      }
    });
  }
});
