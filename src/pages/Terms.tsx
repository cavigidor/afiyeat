import { Link } from 'react-router-dom';
import { Bullets, LegalPage, SupportEmailLink } from '@/components/legal/LegalPage';

const Terms = () => (
  <LegalPage
    title="Terms of Service"
    seoTitle="Terms of Service | Afiyeat"
    seoDescription="The rules for using Afiyeat, including our community guidelines."
    path="/terms"
    updated="October 7, 2026"
    intro={
      <p>
        These terms are an agreement between you and Afiyeat for using the Afiyeat app and website. By
        creating an account or using Afiyeat, you agree to them and to our{' '}
        <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>. If you don't
        agree, please don't use Afiyeat.
      </p>
    }
    sections={[
      {
        title: 'Who can use Afiyeat',
        body: (
          <p>
            You must be at least 13 years old, or older if your country requires it, and able to agree to these
            terms. You're responsible for your account and for keeping your password safe. Tell us at{' '}
            <SupportEmailLink /> if you think someone else is using it.
          </p>
        ),
      },
      {
        title: 'Community guidelines',
        body: (
          <>
            <p>
              <strong>Afiyeat has zero tolerance for objectionable content and abusive users.</strong> You
              agree not to post, share or send anything that:
            </p>
            <Bullets
              items={[
                'harasses, bullies, threatens or intimidates anyone;',
                'is hateful or discriminatory, including slurs and attacks based on race, ethnicity, religion, gender, sexual orientation, disability or similar characteristics;',
                'is sexually explicit or exploits or endangers children in any way;',
                'promotes violence, self-harm or illegal activity;',
                'is spam, scams, misleading, or impersonates another person;',
                "infringes someone else's rights, including copyright and privacy (for example, posting another person's personal information).",
              ]}
            />
            <p>
              You can report content or accounts from the "…" menu and block anyone at any time. We review
              reports, usually within 24 hours. We may remove content, hide it while we review it, or suspend or
              terminate accounts that break these rules, without notice. Content reported by several people
              may be hidden automatically until it's reviewed.
            </p>
          </>
        ),
      },
      {
        title: 'Your content',
        body: (
          <p>
            You own what you post. So that we can run the service, you give Afiyeat a non-exclusive,
            worldwide, royalty-free licence to store, display and share your content with the people your
            settings allow, and to show it in features like Explore and share links. This licence ends when
            you delete the content or your account, except where the content has already been shared by
            others or is kept as described in the Privacy Policy. Only post content you have the right to
            share.
          </p>
        ),
      },
      {
        title: 'Places, maps and other information',
        body: (
          <p>
            Maps and place details are provided by Apple Maps, and events by Ticketmaster. Restaurant
            information, ratings and reviews come from other users. All of this may be incomplete, out of
            date or wrong; check before you rely on it, for example for opening hours, allergens or
            directions.
          </p>
        ),
      },
      {
        title: 'Recipe scanning and AI',
        body: (
          <p>
            Recipe scanning uses an AI service to read photos you choose. It can make mistakes, so check
            scanned recipes, especially ingredients, quantities and allergens, before you use them. Only scan
            material you have the right to use. Scanned recipes stay private unless you choose to make them
            public.
          </p>
        ),
      },
      {
        title: 'Acceptable use',
        body: (
          <Bullets
            items={[
              "Don't try to access other people's accounts or data, or get around privacy settings or blocks.",
              "Don't scrape, overload, reverse-engineer or disrupt the service.",
              "Don't use Afiyeat for anything illegal.",
              "Invites are for real friends: don't create fake accounts or otherwise game Afiyeat Passport.",
            ]}
          />
        ),
      },
      {
        title: 'Ending your account',
        body: (
          <p>
            You can delete your account at any time from Profile in the app. We may suspend or end accounts
            that break these terms or put other users at risk.
          </p>
        ),
      },
      {
        title: 'Disclaimers',
        body: (
          <p>
            Afiyeat is provided "as is" and "as available". To the fullest extent the law allows, we make no
            warranties about the service and aren't liable for indirect or consequential losses arising from
            your use of it. Nothing in these terms limits rights you have under consumer law that can't be
            limited.
          </p>
        ),
      },
      {
        title: 'Apple',
        body: (
          <p>
            If you use Afiyeat on an iPhone, these terms are between you and Afiyeat, not Apple. Apple isn't
            responsible for the app or its content, and has no obligation to provide support for it. Apple and
            its subsidiaries are third-party beneficiaries of these terms and may enforce them.
          </p>
        ),
      },
      {
        title: 'Changes',
        body: (
          <p>
            We may update these terms. We'll change the date above and, for significant changes, tell you in
            the app. If you keep using Afiyeat after a change, you accept the new terms.
          </p>
        ),
      },
      {
        title: 'Contact',
        body: (
          <p>
            Questions about these terms, or to report something urgent: <SupportEmailLink />.
          </p>
        ),
      },
    ]}
  />
);

export default Terms;
