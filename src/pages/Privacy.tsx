import { Link } from 'react-router-dom';
import { Bullets, LegalPage, SupportEmailLink } from '@/components/legal/LegalPage';

// Keep this page in step with ios/App/App/PrivacyInfo.xcprivacy and the
// App Store privacy answers: if the app starts collecting or sharing
// something new, all three change together.

const Privacy = () => (
  <LegalPage
    title="Privacy Policy"
    seoTitle="Privacy Policy | Afiyeat"
    seoDescription="What Afiyeat collects, why, who it's shared with, and how to delete it."
    path="/privacy"
    updated="October 7, 2026"
    intro={
      <>
        <p>
          Afiyeat ("we", "us") is an app and website for saving the restaurants, recipes and places you
          love and sharing them with friends. This policy explains what we collect, why, who helps us run
          the service, and the choices you have. We don't sell your data, we don't show ads, and we don't
          track you across other apps or websites.
        </p>
      </>
    }
    sections={[
      {
        title: 'What we collect',
        body: (
          <>
            <p>
              <strong>Account details.</strong> Your email address, a password (stored only as a secure hash
              by our authentication provider), your username, and anything you add to your profile: display
              name, bio, avatar, and whether your profile is public or private.
            </p>
            <p>
              <strong>What you save and post.</strong> Restaurants, lists and list items, ratings, prices,
              notes, photos, recipes, shared lists and comments, and which places you've been to or want to
              go.
            </p>
            <p>
              <strong>Your connections.</strong> Who you follow, who follows you, follow requests, accounts
              you've blocked, and reports you file.
            </p>
            <p>
              <strong>Location (only if you allow it).</strong> When you allow location, the app uses your
              current position to centre maps, show places near you and suggest nearby search results. We
              don't keep a history of your location or store it on your account.
            </p>
            <p>
              <strong>Photos you choose.</strong> Photos you add to places, lists or recipes are stored with
              your account. Photos you scan to read a recipe are processed and not stored (see "Recipe
              scanning" below).
            </p>
            <p>
              <strong>Device and app information.</strong> If you allow notifications, a push token for your
              device. Your time zone, so reminders arrive at a sensible local time. Basic technical logs our
              hosting providers keep to run and secure the service.
            </p>
            <p>
              <strong>Invitations.</strong> If you join through someone's invite link, we record who invited
              you so their Afiyeat Passport can credit them.
            </p>
          </>
        ),
      },
      {
        title: 'How we use it',
        body: (
          <Bullets
            items={[
              'To run Afiyeat: your lists, maps, recipes, sharing and following.',
              'To show your content to the people you choose: everyone if your profile is public, only approved followers if it is private.',
              'To sign you in, including sending one-time sign-in and password-reset codes by email.',
              'To send notifications you have allowed.',
              'To keep the community safe: filtering obviously abusive text, handling reports and blocks, and preventing referral abuse.',
              'To fix problems and improve the service.',
            ]}
          />
        ),
      },
      {
        title: 'What others can see',
        body: (
          <>
            <p>
              With a <strong>public</strong> profile, your profile, places, lists and public recipes are visible
              to other users, and items you share by link can be opened by anyone with the link, including
              people without an account. With a <strong>private</strong> profile, they're visible only to
              followers you approve.
            </p>
            <p>
              In Explore, places you've been to contribute to overall ratings. If your profile is private,
              people who don't follow you see only an anonymous rating, never your name or notes. Recipes are
              visible to others only if you mark them public. Blocked accounts can't see your content, and
              you can't see theirs.
            </p>
          </>
        ),
      },
      {
        title: 'Service providers we share data with',
        body: (
          <>
            <p>We use a small number of providers to run Afiyeat. Each receives only what it needs:</p>
            <Bullets
              items={[
                <><strong>Supabase</strong>, through <strong>Lovable</strong>: hosting, database, sign-in and photo storage for all account data and content.</>,
                <><strong>Apple Maps</strong>: map display and place search. Your search text, and your approximate location when you've allowed it, are sent to Apple through our server to find nearby places.</>,
                <><strong>Google (Gemini)</strong>, through Lovable's AI service: reads recipe photos you choose to scan.</>,
                <><strong>Resend</strong>: sends sign-in and password-reset emails.</>,
                <><strong>Ticketmaster</strong>: finds events near the area you're looking at in Explore.</>,
                <><strong>Apple Push Notification service</strong>: delivers notifications you've allowed.</>,
              ]}
            />
            <p>
              We may also disclose information if required by law, or to protect the safety of our users or
              the public.
            </p>
          </>
        ),
      },
      {
        title: 'Recipe scanning',
        body: (
          <p>
            Before your first scan, the app asks your permission. When you scan a recipe photo, the photo is
            sent to Google's Gemini AI, through Lovable's AI service, to read the recipe text. Afiyeat doesn't
            store the photo; only the recipe you choose to save is kept. You can always type a recipe in
            instead. Please don't scan photos that show people or personal information.
          </p>
        ),
      },
      {
        title: 'How long we keep it',
        body: (
          <>
            <p>
              We keep your data while your account is open. When you delete your account in the app (Profile →
              Delete account), we delete your account, profile, places, lists, recipes, photos, shared lists
              you're part of, follows, blocks and reports, and your device tokens. Copies may remain in our
              providers' backups for a limited time before they're overwritten.
            </p>
            <p>
              Two things are kept after deletion, to prevent abuse of invitations: the record that an
              invitation happened (no longer linked to your account), and a one-way hash of your email address,
              which lets us recognise a repeat sign-up without storing the address itself.
            </p>
            <p>
              Place details shown in the app (names, addresses and map positions) come from Apple Maps and are
              kept by us only temporarily.
            </p>
          </>
        ),
      },
      {
        title: 'Your choices and rights',
        body: (
          <Bullets
            items={[
              'Edit or delete anything you have posted at any time.',
              'Make your profile private, or remove followers.',
              'Turn off location, camera, photos or notifications in your device settings; the rest of the app keeps working.',
              'Delete your account and its data from Profile in the app.',
              <>Ask for a copy of your data, or for help with any of the above, by emailing <SupportEmailLink />.</>,
            ]}
          />
        ),
      },
      {
        title: 'Security',
        body: (
          <p>
            Data is encrypted in transit and protected by access rules, so only the people you allow can see
            your content. No system is perfectly secure, but we work to protect your information and to fix
            problems quickly.
          </p>
        ),
      },
      {
        title: 'Children',
        body: (
          <p>
            Afiyeat isn't intended for children under 13, and we don't knowingly collect their information. If
            you believe a child under 13 has an account, contact us and we'll delete it.
          </p>
        ),
      },
      {
        title: 'Cookies and local storage',
        body: (
          <p>
            We use your browser's or device's local storage to keep you signed in and remember settings, such
            as list views and the recipe-scanning permission. We don't use advertising or third-party tracking
            cookies.
          </p>
        ),
      },
      {
        title: 'Changes',
        body: (
          <p>
            If we change this policy, we'll update the date above and, for significant changes, let you know in
            the app.
          </p>
        ),
      },
      {
        title: 'Contact',
        body: (
          <p>
            Questions or requests: <SupportEmailLink />. See also our <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>.
          </p>
        ),
      },
    ]}
  />
);

export default Privacy;
