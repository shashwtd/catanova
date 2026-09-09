import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import type { useAuth } from './auth.js';
import { ProfileEditor } from './Profile.js';

type Auth = ReturnType<typeof useAuth>;

export function AccountSetup({ auth }: { auth: Auth }) {
  const initial = auth.account?.profile ?? defaultProfile(auth.account?.username ?? '');
  return (
    <section className="account-setup" aria-labelledby="account-setup-title">
      <h2 id="account-setup-title">Set up your account</h2>
      <p className="account-intro">Choose a unique username and a portrait before joining the table.</p>
      {auth.account?.isGuest && (
        <p className="account-note">Playing as a guest. You can link Google later and keep this username.</p>
      )}
      <ProfileEditor
        key={auth.account?.id ?? 'account-setup'}
        initial={initial}
        busy={auth.loading}
        checkUsername={auth.checkUsername}
        googleAvatarUrl={auth.googleAvatarUrl}
        submitLabel="Continue"
        onSave={async (profile) => {
          await auth.saveProfile(profile);
        }}
      />
    </section>
  );
}
