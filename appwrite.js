const client = new Appwrite.Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('6abbc1320035e52c7a18');
const account = new Appwrite.Account(client);
const functions = new Appwrite.Functions(client);
const OAUTH_PENDING_KEY = 'niji-google-oauth-pending';

window.nijiAppwrite = { client, account, functions, config: window.NIJI_APPWRITE_CONFIG };

function showOAuthError(message) {
  const formError = document.getElementById('form-error');
  if (formError) {
    formError.textContent = message;
    formError.classList.remove('hidden');
    return;
  }
  window.alert(message);
}

function googleOAuthFailureMessage(action, error) {
  const normalized = String(error || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (action === 'signup' && /(user|account|email).{0,40}(already exists|already registered|already in use)|already exists.{0,40}(user|account|email)/.test(normalized)) {
    return 'This account already exists. Log-in instead.';
  }
  if (action === 'login' && /(user|account).{0,40}(not found|does not exist)|account does not exist/.test(normalized)) {
    return 'No Niji account exists for this Google account. Please sign up first.';
  }
  return 'Google login failed. If the problem persists, try another sign-in method or contact the administrator.';
}

function callbackUrl(result) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set('oauth', result);
  return url.toString();
}

async function beginGoogleOAuth(action, role) {
  if (action === 'link-google') {
    showOAuthError('Google account linking is not available through the current Appwrite OAuth flow.');
    return;
  }

  try {
    const switched = await window.nijiAuth.prepareAccountSwitch('Google');
    if (!switched) {
      window.resetAuthButton?.(document.getElementById('google-btn'));
      return;
    }
    window.nijiAuth.clearPendingSignup();
    sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ action, role }));
    await account.createOAuth2Token({
      provider: 'google',
      success: callbackUrl('success'),
      failure: callbackUrl('failure'),
      scopes: ['email', 'profile'],
    });
  } catch (error) {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    window.resetAuthButton?.(document.getElementById('google-btn'));
    console.error('Appwrite Google OAuth could not be started:', error);
    showOAuthError(`Could not start Google sign-in: ${error.message || error}`);
  }
}

window.startGoogleOAuth = (action) => {
  const button = document.getElementById('google-btn');
  if (button?.disabled) return;
  const flow = action || (document.getElementById('auth-form')?.dataset.mode === 'signup' ? 'signup' : 'login');
  const role = document.getElementById('role-professor')?.getAttribute('aria-pressed') === 'true'
    ? 'professor'
    : 'student';
  window.setAuthButtonLoading?.(button, flow === 'signup' ? 'Creating account...' : 'Logging in...');
  void beginGoogleOAuth(flow, role);
}

function retryGoogleProfileButton() {
  const formError = document.getElementById('form-error');
  if (!formError) return;
  let button = document.getElementById('google-profile-retry');
  if (!button) {
    button = document.createElement('button');
    button.id = 'google-profile-retry';
    button.type = 'button';
    button.className = 'mt-2 text-[12px] font-semibold text-[#005a9c] underline';
    button.textContent = 'Retry profile setup';
    formError.insertAdjacentElement('afterend', button);
  }
  button.hidden = false;
  button.disabled = false;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const pendingText = sessionStorage.getItem(OAUTH_PENDING_KEY);
      if (!pendingText) throw new Error('The Google sign-in request expired. Start Google sign-in again.');
      const pending = JSON.parse(pendingText);
      const authResult = await window.nijiAuth.loginGoogleUser({
        requestedRole: pending.role,
        expectedUserId: pending.oauthUserId,
        isSignup: pending.action === 'signup',
      });
      if (authResult.error) {
        showOAuthError(authResult.error);
        button.disabled = false;
        return;
      }
      sessionStorage.removeItem(OAUTH_PENDING_KEY);
      button.hidden = true;
      window.location.replace(authDestination(authResult.user));
    } catch (error) {
      console.error('Google profile setup retry failed:', error);
      showOAuthError(`Could not finish setting up your profile: ${error.message || error}`);
      button.disabled = false;
    }
  };
}

async function completeGoogleOAuth() {
  const url = new URL(window.location.href);
  const callbackResult = url.searchParams.get('oauth');
  const oauthUserId = url.searchParams.get('userId');
  const oauthSecret = url.searchParams.get('secret');
  if (!callbackResult) return;
  window.nijiAuth.clearPendingSignup();
  const pendingText = sessionStorage.getItem(OAUTH_PENDING_KEY);
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
  url.searchParams.delete('oauth');
  url.searchParams.delete('userId');
  url.searchParams.delete('secret');
  url.searchParams.delete('error_description');
  url.searchParams.delete('error');
  window.history.replaceState({}, '', url);

  if (!pendingText) {
    showOAuthError('Google sign-in could not be completed because its pending request was not found. Please try again.');
    return;
  }

  let pending;
  try {
    pending = JSON.parse(pendingText);
  } catch (error) {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    console.error('Invalid pending Google OAuth data:', error);
    showOAuthError('Google sign-in could not be completed. Please try again.');
    return;
  }
  if (!pending || !['signup', 'login', 'link-google'].includes(pending.action)) {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    showOAuthError('Google sign-in could not be completed. Please try again.');
    return;
  }

  if (callbackResult !== 'success') {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    showOAuthError(googleOAuthFailureMessage(pending.action, oauthError));
    return;
  }

  try {
    if (!oauthUserId || !oauthSecret) {
      sessionStorage.removeItem(OAUTH_PENDING_KEY);
      throw new Error('Appwrite did not return the Google sign-in credentials. Please try again.');
    }
    await account.createSession({ userId: oauthUserId, secret: oauthSecret });

    if (pending.action === 'link-google') {
      sessionStorage.removeItem(OAUTH_PENDING_KEY);
      showOAuthError('Google account linking is not available through the current Appwrite OAuth flow.');
      return;
    }
    const authResult = await window.nijiAuth.loginGoogleUser({
      requestedRole: pending.role,
      expectedUserId: oauthUserId,
      isSignup: pending.action === 'signup',
    });
    if (authResult.error) {
      showOAuthError(authResult.error);
      if (authResult.retryable) {
        pending.oauthUserId = oauthUserId;
        sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify(pending));
        retryGoogleProfileButton();
      } else {
        sessionStorage.removeItem(OAUTH_PENDING_KEY);
      }
      return;
    }
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    window.location.replace(authDestination(authResult.user));
  } catch (error) {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    console.error('Appwrite Google OAuth could not be completed:', error);
    showOAuthError(`Google sign-in could not be completed: ${error.message || error}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('google-btn')?.addEventListener('click', () => {
    window.startGoogleOAuth();
  });
  void completeGoogleOAuth();
});
