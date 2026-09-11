import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import type { useAuth } from './auth.js';
import { ProfileEditor } from './Profile.js';

type Auth = ReturnType<typeof useAuth>;

export function AccountSetup({ auth }: { auth: Auth }) {
  const initial = {
    ...(auth.account?.profile ?? defaultProfile('')),
    // A provider's old display name is not a chosen Catanova username.
    name: auth.account?.username ?? '',
    username: auth.account?.username ?? undefined,
  };
  return (
    <section className="account-setup" aria-labelledby="account-setup-title">
      <h2 id="account-setup-title">Set up your account</h2>
      <p className="account-intro">Pick a username. You can change your avatar anytime in the lobby.</p>
      {auth.account?.isGuest && (
        <p className="account-note">Playing as a guest. You can link Google later and keep this username.</p>
      )}
      <ProfileEditor
        key={auth.account?.id ?? 'account-setup'}
        initial={initial}
        busy={auth.loading}
        checkUsername={auth.checkUsername}
        submitLabel="Continue"
        onSave={async (profile) => {
          await auth.saveProfile(profile);
        }}
      />
    </section>
  );
}
